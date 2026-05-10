import { headers } from "next/headers";
import { MetadataRoute } from "next";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const headersList = await headers();
  const host = headersList.get("host") || "";

  const noindex = host.startsWith("admin.") || host.startsWith("staging");

  if (noindex) {
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }

  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://www.mychesstour.com/sitemap.xml",
  };
}
