import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "StarMapper — Map your GitHub stargazers",
  description: "See where in the world your GitHub repo's fans are — geocoded, clustered, and beautiful.",
  openGraph: {
    title: "StarMapper — Map your GitHub stargazers",
    description: "See where in the world your GitHub repo's fans are — geocoded, clustered, and beautiful.",
    siteName: "StarMapper",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "StarMapper — Map your GitHub stargazers",
    description: "See where in the world your GitHub repo's fans are — geocoded, clustered, and beautiful.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.className} bg-[#0d1117]`}>{children}</body>
    </html>
  );
}
