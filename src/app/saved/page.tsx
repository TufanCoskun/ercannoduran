import type { Metadata } from "next";
import { SavedView } from "@/components/SavedView";

export const metadata: Metadata = {
  title: "Kaydedilenler",
  description: "Kaydettiğin reklamlar ve koleksiyonların.",
};

export default function SavedPage() {
  return <SavedView />;
}
