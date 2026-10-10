import type { Metadata } from "next";
import { LogoutButton } from "@/components/LogoutButton";
import { SavedView } from "@/components/SavedView";

export const metadata: Metadata = {
  title: "Kaydedilenler",
  description: "Kaydettiğin reklamlar ve koleksiyonların.",
};

export default function SavedPage() {
  return (
    <>
      <SavedView />
      <div className="mx-auto max-w-6xl px-4 pb-10 lg:px-8">
        <LogoutButton />
      </div>
    </>
  );
}
