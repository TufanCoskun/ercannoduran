import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[80dvh] place-items-center px-6 text-center">
      <div>
        <p className="text-6xl font-black text-volt">404</p>
        <h1 className="mt-3 text-xl font-bold">Bu reklam artık burada değil</h1>
        <p className="mt-1 text-sm text-mist">Veri yenilenmiş olabilir. Akışta benzerlerini bul.</p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-volt px-5 py-2.5 text-sm font-bold text-black">
          Akışa dön
        </Link>
      </div>
    </div>
  );
}
