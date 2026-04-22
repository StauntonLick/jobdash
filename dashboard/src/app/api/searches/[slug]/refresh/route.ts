import { NextRequest, NextResponse } from "next/server";

import { loadOrRunSearch } from "@/lib/jobspy-service";
import { loadSearchConfig } from "@/lib/search-config";

type Params = {
  params: Promise<{ slug: string }>;
};

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const { definitions, filters } = await loadSearchConfig();
    const definition = definitions.find((item) => item.slug === slug);

    if (!definition) {
      return NextResponse.json({ error: `Unknown search: ${slug}` }, { status: 404 });
    }

    const search = await loadOrRunSearch(definition, true, filters);
    return NextResponse.json({ search });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to refresh search: ${String(error)}` },
      { status: 500 }
    );
  }
}
