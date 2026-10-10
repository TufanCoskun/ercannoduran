# AdGym — Reklam kasını her gün çalıştır

AdGym, gerçek ve **yüksek performanslı reklamları** TikTok gibi dikey bir akışta kaydırarak
pazarlama sezgini her gün geliştirmen için yapılmış bir uygulama. Reklamlar Meta Ad Library,
TikTok (Creative Center / Commercial Content API) ve elle seçilmiş klasiklerden ("Efsane reklam") gelir.

- **Segmentler:** DTC markalar, oteller / turizm, Türkiye, ABD, genel (büyük markalar)
- **Akış:** tam ekran, kaydırmalı; video görünürken sessiz otomatik oynar, carousel'ler yana kayar,
  görseli olmayan (ya da linki süresi dolmuş) reklamlar marka renkli bir metin kartı olarak gösterilir.
- **"Kazanan" skoru:** harcama verisi açık olmadığı için uzun süre yayında kalma, hâlâ aktif olma,
  varyasyon sayısı, platform sayısı ve TikTok Top Ads sinyallerinden üretilen 0–100 arası bir proxy
  (`src/lib/score.ts`, `scripts/ingest/score.mjs` ile aynı).
- **Bugünün antrenmanı:** her gün tarihe göre sabit seçilen 10 reklam, ilerleme sayacı ve günlük seri (streak).
- **Filtreler:** segment, pazar, kaynak, format, kategori, marka — hepsi URL'de
  (`/?segment=dtc&market=TR`), yani filtreli akış paylaşılabilir.
- **Kaydet:** koleksiyonlar (oluştur / yeniden adlandır / sil / taşı) ve reklam başına
  "Neden çalışıyor?" notu. Veriler tarayıcıda (`localStorage`) tutulur.
- **Paylaş:** her reklamın kendi sayfası (`/ad/[id]`, OG etiketli), sistem paylaşım menüsü,
  link kopyalama ve "WhatsApp'ta gönder".
- **Markalar:** `/brands` — markaya dokun, sadece onun reklamlarını kaydır.
- Masaüstünde klavye: `↑/↓` veya `j/k` gezin, `s` kaydet, `m` ses.

## Yerelde çalıştırma

Gereksinim: Node.js 20+ (ingest scriptleri için Node 22 önerilir).

```bash
npm install
npm run dev        # http://localhost:3000
```

Üretim derlemesi:

```bash
npm run build
npm start
npm run lint
```

## Veri

Uygulamanın veritabanı yok. Reklamlar `data/ads/*.json` dosyalarından okunur
(her dosya `{ "generatedAt": string, "ads": Ad[] }`, şema: `src/lib/types.ts`):

| Dosya | İçerik |
|---|---|
| `data/ads/meta-tr.json` | Meta Ad Library — Türkiye |
| `data/ads/meta-us.json` | Meta Ad Library — ABD |
| `data/ads/tiktok.json` | TikTok reklamları |
| `data/ads/curated.json` | Elle seçilmiş klasikler (YouTube videoları dahil) |
| `data/media/*.json` | Opsiyonel medya zenginleştirme katmanı (`{ generatedAt, items: { [adId]: {...} } }`) |

`src/lib/ads.ts` tüm dosyaları okur, bozuk/eksik dosyaları atlar, medya katmanını id ile birleştirir,
`id`'ye göre tekilleştirir ve skora göre sıralar. Hiç reklam yoksa geliştirme için örnek veri
(`src/lib/fixtures.ts`) gösterilir ve akışta "Demo verisi" etiketi çıkar.

### Veriyi yenileme

```bash
META_AD_LIBRARY_TOKEN=... npm run ingest      # hepsi
META_AD_LIBRARY_TOKEN=... npm run ingest:meta # sadece Meta
npm run ingest:tiktok                         # sadece TikTok (TIKTOK_* env değişkenleri)
```

Ayrıntılar: `docs/INGESTION.md`. İzlenen marka listesi `data/brands.json` içinde.
Veri statik olduğu için yeni veriden sonra yeniden derleme (ya da yeniden deploy) gerekir.

> Not: fbcdn / tiktokcdn medya linkleri bir süre sonra geçersiz olur. Uygulama bunu bekler:
> video açılmazsa kapak görseline, o da açılmazsa metin kartına düşer. Düzenli `npm run ingest` önerilir.

## Vercel'e deploy

1. Repoyu Vercel'e bağla (Framework: **Next.js**, build komutu `npm run build`, ek ayar gerekmez).
2. Opsiyonel ortam değişkeni: `NEXT_PUBLIC_SITE_URL=https://alanadin.com` (OG linkleri için;
   verilmezse Vercel URL'i kullanılır).
3. Veriyi güncellemek için yerelde `npm run ingest` çalıştırıp değişen `data/` dosyalarını commit'le;
   Vercel otomatik yeniden derler. (İstersen ingest'i bir GitHub Action / Vercel Cron ile zamanlayabilirsin.)

## Proje yapısı

```
src/app/            sayfalar: / (akış), /ad/[id], /saved, /brands
src/components/     Feed, AdCard, AdMediaView, TextCard, FilterPanel, SavedView, BrandsView, ...
src/lib/            types, score, ads (sunucu tarafı yükleyici), filters, daily, saved, youtube
scripts/ingest/     veri toplama scriptleri (Node ESM, ek bağımlılık yok)
data/               reklam JSON'ları ve marka listesi
```
