import type { PropsWithChildren } from "react";
import { ScrollViewStyleReset } from "expo-router/html";

// Web document shell (web export only). Keeps the page background dark
// before the app paints, so there is no white flash on load or overscroll.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="theme-color" content="#0a0d12" />
        <meta name="color-scheme" content="dark" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: "html,body{background-color:#0a0d12;color:#f2f5f8;}" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
