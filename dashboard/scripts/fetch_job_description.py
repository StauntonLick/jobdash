import json
import re
import sys
from typing import Optional
from urllib.parse import parse_qs, urlparse

import requests
from bs4 import BeautifulSoup
from markdownify import markdownify as md

try:
    from jobspy.util import markdown_converter, remove_attributes
except Exception:
    markdown_converter = None
    remove_attributes = None


DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-GB,en;q=0.9",
}

GLASSDOOR_FALLBACK_CSRF_TOKEN = (
    "Ft6oHEWlRZrxDww95Cpazw:0pGUrkb2y3TyOpAIqF2vbPmUXoXVkD3oEGDVkvfeCerceQ5-"
    "n8mBg3BovySUIjmCPHCaW0H2nQVdqzbtsYqf4Q:wcqRqeegRUa9MVLJGyujVXB7vWFPjdaS1CtrrzJq-ok"
)

GLASSDOOR_HEADERS = {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "apollographql-client-name": "job-search-next",
    "apollographql-client-version": "4.65.5",
    "content-type": "application/json",
    "origin": "https://www.glassdoor.com",
    "referer": "https://www.glassdoor.com/",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
}


def _normalize_text(text: str) -> str:
    collapsed = re.sub(r"\r\n?", "\n", text)
    collapsed = re.sub(r"\n{3,}", "\n\n", collapsed)
    collapsed = re.sub(r"[ \t]+", " ", collapsed)
    return collapsed.strip()


def _to_markdown(description_html: str) -> str:
    if markdown_converter:
        converted = markdown_converter(description_html)
        return (converted or "").strip()
    return md(description_html).strip()


def _is_likely_html(text: str) -> bool:
    return bool(re.search(r"<[^>]+>", text))


def _extract_by_selectors(soup: BeautifulSoup, selectors: list[str]) -> Optional[str]:
    for selector in selectors:
        node = soup.select_one(selector)
        if not node:
            continue
        text = _normalize_text(node.get_text("\n", strip=True))
        if len(text) >= 80:
            return text
    return None


def _extract_linkedin_description(soup: BeautifulSoup) -> Optional[str]:
    div_content = soup.find(
        "div", class_=lambda x: x and "show-more-less-html__markup" in x
    )

    if not div_content:
        return None

    if remove_attributes:
        div_content = remove_attributes(div_content)
    else:
        for attr in list(div_content.attrs):
            del div_content[attr]

    description_html = div_content.prettify(formatter="html")
    description_markdown = _to_markdown(description_html)
    return description_markdown or None


def _extract_indeed_description(soup: BeautifulSoup) -> Optional[str]:
    selectors = [
        "#jobDescriptionText",
        "div[data-testid='jobDescriptionText']",
    ]
    return _extract_by_selectors(soup, selectors)


def _extract_glassdoor_job_id(url: str) -> Optional[str]:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    jl = query.get("jl")
    if jl and jl[0].strip().isdigit():
        return jl[0].strip()

    match = re.search(r"[?&]jl=(\d+)", url)
    if match:
        return match.group(1)

    return None


def _extract_glassdoor_base_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return "https://www.glassdoor.com"


def _fetch_glassdoor_csrf_token(session: requests.Session, base_url: str) -> str:
    try:
        res = session.get(f"{base_url}/Job/computer-science-jobs.htm", timeout=12)
        matches = re.findall(r'"token":\s*"([^"]+)"', res.text)
        if matches:
            return matches[0]
    except Exception:
        return GLASSDOOR_FALLBACK_CSRF_TOKEN

    return GLASSDOOR_FALLBACK_CSRF_TOKEN


def _extract_glassdoor_description(url: str) -> Optional[str]:
    job_id = _extract_glassdoor_job_id(url)
    if not job_id:
        return None

    base_url = _extract_glassdoor_base_url(url)
    session = requests.Session()

    headers = {
        **GLASSDOOR_HEADERS,
        "user-agent": DEFAULT_HEADERS["User-Agent"],
        "origin": base_url,
        "referer": f"{base_url}/",
    }

    headers["gd-csrf-token"] = _fetch_glassdoor_csrf_token(session, base_url)

    body = [
        {
            "operationName": "JobDetailQuery",
            "variables": {
                "jl": int(job_id),
                "queryString": "q",
                "pageTypeEnum": "SERP",
            },
            "query": """
                query JobDetailQuery($jl: Long!, $queryString: String, $pageTypeEnum: PageTypeEnum) {
                    jobview: jobView(
                        listingId: $jl
                        contextHolder: {queryString: $queryString, pageTypeEnum: $pageTypeEnum}
                    ) {
                        job {
                            description
                            __typename
                        }
                        __typename
                    }
                }
            """,
        }
    ]

    try:
        response = session.post(
            f"{base_url}/graph",
            json=body,
            headers=headers,
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json()[0]
        description_raw = payload["data"]["jobview"]["job"]["description"]
        description_text = str(description_raw or "").strip()
        if not description_text:
            return None

        if _is_likely_html(description_text):
            return _to_markdown(description_text)

        return _normalize_text(description_text)
    except Exception:
        return None


def _extract_generic_description(soup: BeautifulSoup) -> Optional[str]:
    meta = soup.find("meta", attrs={"property": "og:description"})
    if meta:
        content = _normalize_text(str(meta.get("content", "")))
        if len(content) >= 80:
            return content

    selectors = [
        "main",
        "article",
    ]
    return _extract_by_selectors(soup, selectors)


def fetch_description(site: str, url: str) -> str:
    if not url:
        return ""

    normalized_site = site.strip().lower()

    if normalized_site == "glassdoor":
        description = _extract_glassdoor_description(url)
        return description or ""

    try:
        response = requests.get(url, headers=DEFAULT_HEADERS, timeout=12)
        response.raise_for_status()
    except Exception:
        return ""

    if normalized_site == "linkedin" and "linkedin.com/signup" in response.url:
        return ""

    soup = BeautifulSoup(response.text, "html.parser")

    if normalized_site == "linkedin":
        description = _extract_linkedin_description(soup)
    elif normalized_site == "indeed":
        description = _extract_indeed_description(soup)
    else:
        description = None

    if not description:
        description = _extract_generic_description(soup)

    return description or ""


def main() -> int:
    try:
        raw = sys.stdin.read().strip()
        payload = json.loads(raw) if raw else {}
        site = str(payload.get("site", "")).strip()
        url = str(payload.get("url", "")).strip()
        description = fetch_description(site, url)
        print(json.dumps({"description": description}))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc), "description": ""}))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
