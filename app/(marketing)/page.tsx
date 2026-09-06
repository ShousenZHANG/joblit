import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { ImmersiveLanding } from "@/components/landing/ImmersiveLanding";

const copy = {
  en: {
    title: "Your next role starts here",
    description: "Your Australian job search, in one workspace. Discover roles, tailor your resume from your real experience, and prepare your next application with Joblit.",
  },
  zh: {
    title: "下一份理想工作，从这里开始",
    description: "面向澳洲求职的个人工作台。发现职位、基于真实履历定制简历与求职信，整理每一次申请。",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const text = copy[(await getLocale()) === "zh" ? "zh" : "en"];
  return {
    ...text,
    openGraph: { ...text, title: `Joblit — ${text.title}`, type: "website", siteName: "Joblit" },
    twitter: { ...text, title: `Joblit — ${text.title}`, card: "summary_large_image" },
  };
}

export default async function MarketingPage() {
  const text = copy[(await getLocale()) === "zh" ? "zh" : "en"];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Joblit",
    description: text.description,
    applicationCategory: "BusinessApplication",
  };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    <ImmersiveLanding />
  </>;
}
