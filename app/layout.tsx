import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const ogUrl = `${protocol}://${host}/og.png`;
  const description = "西安科技大学测绘科学与技术学院陈鹏老师课题组——全球电离层建模、GNSS近地空间环境与InSAR研究。";
  return {
    title: { default: "SEGM · 空间环境与地质灾害监测课题组", template: "%s · SEGM" },
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "SEGM · 空间环境与地质灾害监测课题组",
      description,
      type: "website",
      locale: "zh_CN",
      images: [{ url: ogUrl, width: 1734, height: 907, alt: "SEGM课题组全球电离层研究" }],
    },
    twitter: { card: "summary_large_image", title: "SEGM · 空间环境与地质灾害监测课题组", description, images: [ogUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
