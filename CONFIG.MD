### This file contains a set of controls for JobSpy in lieu of user interface.

## SEARCH PARAMETERS

### Edinburgh

    site_name=["indeed", "linkedin", "glassdoor"],
    search_term='("UX" OR "Product Designer" OR "User Researcher"),
    location="Edinburgh",
    distance="10",
    results_wanted=30,
    hours_old=168,
    country_indeed="UK",
    is_remote="False"

### Glasgow

    site_name=["indeed", "linkedin", "glassdoor"],
    search_term='("UX" OR "Product Designer" OR "User Researcher"),
    location="Glasgow",
    distance="10",
    results_wanted=30,
    hours_old=168,
    country_indeed="UK",
    is_remote=False

### Newcastle

    site_name=["indeed", "linkedin", "glassdoor"],
    search_term='("UX" OR "Product Designer" OR "User Researcher"),
    location="Newcastle",
    distance="10",
    results_wanted=30,
    hours_old=168,
    country_indeed="UK",
    is_remote=False

### Scotland

    site_name=["indeed", "linkedin", "glassdoor"],
    search_term='("UX" OR "Product Designer" OR "User Researcher"),
    location="Scotland",
    results_wanted=30,
    hours_old=168,
    country_indeed="UK",
    is_remote=False

### London

    site_name=["indeed", "linkedin", "glassdoor"],
    search_term='("UX" OR "Product Designer" OR "User Researcher"),
    location="London",
    distance="10",
    results_wanted=30,
    hours_old=168,
    country_indeed="UK",
    is_remote=False

### UK Remote

    site_name=["indeed", "linkedin", "glassdoor"],
    search_term='("UX" OR "Product Designer" OR "User Researcher"),
    location="United Kingdom",
    results_wanted=30,
    hours_old=168,
    country_indeed="UK",
    is_remote=True

## FILTERS
Listings returned from the above searches will be filtered by these job titles to avoid false positives (e.g. where the search term is mentioned in the job description)

Include jobs where the title includes at least one of the following:
- UX
- User Experience
- User
- Product
- Designer
- Researcher

Exclude jobs where the title includes any of the following:
- Developer
- Artist
- Engineer
- Content
- Graphic
- Product Manager
- Product Owner
- Management
- Marketing
