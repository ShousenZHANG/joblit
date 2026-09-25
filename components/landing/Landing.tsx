import { ApplicationDemo } from "./ApplicationDemo";
import { Closing, SiteFooter } from "./Closing";
import { Details } from "./Details";
import { Faq } from "./Faq";
import { GetStarted } from "./GetStarted";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import { SiteHeader } from "./SiteHeader";
import { YourModel } from "./YourModel";
import styles from "./Landing.module.css";

/**
 * The marketing page. Sections render on the server; only the header, the
 * interactive demo and the session-aware workspace links ship client code.
 */
export function Landing() {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className={styles.main}>
        <Hero />
        <HowItWorks />
        <ApplicationDemo />
        <YourModel />
        <Details />
        <GetStarted />
        <Faq />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}
