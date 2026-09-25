import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { Landing } from "@/components/landing/Landing";

const copy = {
  en: {
    title: "Tailored to the role. True to your résumé.",
    description: "Your Australian job search in one workspace. Find roles, see what each one asks for, and tailor your résumé using only the skills and experience you already have.",
  },
  zh: {
    title: "为职位定制，忠于你的简历。",
    description: "面向澳洲求职的个人工作台。发现职位、看清每个职位的要求，只用你已有的技能和经历来定制简历。",
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
    <Landing />
  </>;
}
