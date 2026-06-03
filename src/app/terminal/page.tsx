import type { Metadata } from "next";
import { TerminalView } from "@/components/terminal/TerminalView";

export const metadata: Metadata = {
  title: "Terminal",
  description:
    "The ApeWise smart-money terminal — live segmented wallet flows, top-wallet leaderboard and real-time token inflows. Sample data, private beta.",
  alternates: { canonical: "/terminal" },
};

export default function TerminalPage() {
  return <TerminalView />;
}
