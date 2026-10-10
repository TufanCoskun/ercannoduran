import type { Metadata } from "next";
import Link from "next/link";
import { TinderHistory } from "@/components/tinder/TinderHistory";

export const metadata: Metadata = {
  title: "Tinder özetleri",
  description: "Tinder oturumların: Round 1, Round 2… kazananları ve final kazananı.",
};

export default function TinderHistoryPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-6 lg:px-8 lg:pt-10">
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight lg:text-4xl">Tinder özetleri</h1>
          <p className="mt-1 text-sm text-mist">Her oturumun turları ve kazananı · bu cihazda saklanır</p>
        </div>
        <Link href="/tinder" className="shrink-0 rounded-full bg-volt px-4 py-2 text-sm font-bold text-black">
          Yeni Tinder
        </Link>
      </header>
      <TinderHistory />
    </div>
  );
}
