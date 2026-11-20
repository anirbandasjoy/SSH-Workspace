import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "@primer/primitives/dist/css/functional/themes/dark.css";
import "@primer/primitives/dist/css/functional/size/size.css";
import "@primer/primitives/dist/css/functional/size/radius.css";
import "@primer/primitives/dist/css/functional/size/border.css";
import "@primer/primitives/dist/css/functional/typography/typography.css";
import "./globals.css";
import { site } from "./site";

const monaSans = localFont({
  src: "./fonts/mona-sans.woff2",
  variable: "--font-mona-sans",
  weight: "200 900",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: `${site.name}: switch GitHub accounts and SSH keys with confidence`,
  description: site.description,
  openGraph: {
    title: site.name,
    description: site.description,
    images: ["/screenshots/repositories.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0d1117",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-color-mode="dark"
      data-dark-theme="dark"
      data-light-theme="light"
      className={monaSans.variable}
    >
      <body>{children}</body>
    </html>
  );
}
