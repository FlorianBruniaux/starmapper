import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "StarMapper — Map your GitHub stargazers",
  description: "Visualize where your GitHub stargazers are in the world",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.className} bg-[#0d1117]`}>{children}</body>
    </html>
  );
}
