import Script from "next/script";
import markup from "./markup";

// The site is one page with hash routes (#studies, #blog, #admin ...).
// Its markup and script are generated from the design file by build_next.py.
export default function Page() {
  return (
    <>
      <div id="site-root" dangerouslySetInnerHTML={{ __html: markup }} suppressHydrationWarning />
      <Script src="/site.js" strategy="afterInteractive" />
    </>
  );
}
