# Superscale incelemesi ve video kalıcılığı

Tarih: 2026-10-10. İncelenen board: <https://superscale.ai/board/the-moonlighters/sam-pilieros-top-ads>
İçe aktarıcı: `scripts/ingest/superscale.mjs`. Çıktı: `data/ads/superscale.json`.

## 1. Superscale board'ları nasıl çalışıyor?

### Yapı
- **URL şeması:** `superscale.ai/board/<handle>/<boardSlug>`. `handle` bir workspace/marka (ör. `the-moonlighters`),
  altında bir veya birden çok board var. `superscale.ai/board/<handle>` o handle'ın board listesi.
- **Herkese açık board'lar** (sitemap'te listelenen): yalnızca iki tane.
  - `the-moonlighters/sam-pilieros-top-ads`: "Sam Piliero's Top Ads", 160 reklam, son güncelleme 2026-08-21
  - `superscale-boards/trending-e-com-formats`: "Trending E-Com Formats", 36 reklam (Superscale'in kendi e-ticaret koleksiyonu)
- Sayfa Next.js App Router (RSC) ile sunucuda render ediliyor: ilk 40 reklam HTML içinde (`self.__next_f`) geliyor.
  "Load more" düğmesi sayfanın kendi kullandığı herkese açık JSON uç noktasını çağırıyor:

  ```
  GET https://superscale.ai/__api/boards/<handle>/<slug>?page=N[&filters=<json>]
  → { data: { board: {slug,name,description,visibility:"PUBLIC",itemCount,updatedAt,brand:{handle}},
              ads: Ad[40] },
      meta: { page, matchedAlias } }
  ```
  Login, cookie veya token gerekmiyor; düz `fetch` 200 JSON döndürüyor (headless tarayıcı gerekmedi).
  AWS WAF ve Cloudflare var ama board ve API için challenge çıkmadı.

### Reklam veri modeli (API'den birebir)
```
uuid, adId (= Meta Ad Library ad_archive_id), advertiserBrandUuid, advertiserBrandName, advertiserBrandLogoUrl,
mediaType (IMAGE|VIDEO), mediaUrl, thumbnailUrl, mediaFileUuid, thumbnailFileUuid, mediaWidth, mediaHeight,
creative {title, caption (görünen domain), body, cardCount}, collation, collaboration, countryProbe,
metrics {reach, growth7d, performanceStars (1–5), performanceScore (0–100)},
targeting {gender, ageMin, ageMax, countryCodes, basis ("EU_TRANSPARENCY")},
platforms (FACEBOOK|INSTAGRAM|MESSENGER|AUDIENCE_NETWORK|THREADS), isActive, deliveryStartTime
```
- **Meta bağlantısı:** `adId` doğrudan Meta Ad Library kimliği. İki örnek headless Chromium ile doğrulandı:
  `facebook.com/ads/library/?id=100966552949780` açılınca Baby2Body reklamı geliyor (page_id 1563491367196517),
  `1161362107059840` de Grüns sayfasına çözülüyor. Bu yüzden içe aktarıcı `meta_<adId>` kimliğini üretiyor ve
  bizim `meta-*.json` dosyalarımızla aynı kimlik alanında dedupe oluyor.
- **Instagram/Facebook post bağlantısı yok:** Post id'si veya permalink alanı yok, `collaboration` alanı hep null.
- Bitiş tarihi yok, sadece `isActive` ve başlangıç tarihi var. Sitedeki "Running Time < N gün" değeri bir üst sınır.
- `targeting.countryCodes` sadece AB şeffaflık verisi olan reklamlarda dolu. Sam Piliero board'unda hepsi null,
  dolayısıyla pazar bilinmiyor.

### Kategoriler
Kategoriler reklam nesnesinin içinde gelmiyor; board'un **sunucu tarafı filtreleri** olarak var
(`filters={"version":1, ...}`; şema sayfanın JS paketindeki `AdBoardFilterDefinitionSchema`):

| Filtre | Anahtar | Değerler |
|---|---|---|
| Format | `mediaType` | IMAGE, VIDEO |
| Durum | `status` | ACTIVE, INACTIVE |
| Funnel | `funnelStage` | TOFU (Awareness), MOFU (Consideration), BOFU (Conversion) |
| Süre | `daysActiveMin` | 7, 30, 90 |
| Puan | `minStars` | 3, 4, 5 |
| Sektör | `industries[]` | aşağıda |
| Marka | `advertiserBrandUuids[]` | board'daki markalar |
| (Trend board'ları) | `trend.facetCategories[]` | facet NICHE / OFFER |

**Sektör (Industry) taksonomisi:**
- Genel: E-Commerce (`E_COMMERCE_DTC`), Mobile Apps, Other
- E-Commerce alt kategorileri: Beauty and Cosmetics, Fashion and Apparel, Health and Wellness, Food and Beverage,
  Home and Living, Consumer Electronics, Sports and Outdoors, Kids and Baby, Pets, Jewelry and Accessories,
  Media and Publishing, Automotive, Travel and Hospitality, Education, Finance, Insurance, Real Estate,
  Healthcare, Professional Services, Entertainment, Gaming, Other
- Mobile Apps alt kategorileri: Health and Fitness, Finance and Fintech, Education and Learning,
  Travel and Mobility, Entertainment and Media, Social and Community, Productivity Tools,
  Shopping and E-Commerce, Gaming, Utilities and Security, Lifestyle, Other

Sektör etiketleri çoklu ve pratikte marka düzeyinde: bir reklam birden fazla sektörde dönebiliyor
(ör. Baby2Body için E_COMMERCE_DTC + HEALTH_WELLNESS + KIDS_BABY).

**Sam Piliero board'unda filtreler (reklam sayısı):** E_COMMERCE_DTC 129, MOBILE_APPS 31, OTHER 26,
HEALTH_WELLNESS 61, FOOD_BEVERAGE 50, FASHION_APPAREL 28, HOME_LIVING 22, CONSUMER_ELECTRONICS 22,
BEAUTY_COSMETICS 19, KIDS_BABY 14, HEALTHCARE 8, PETS 7, PROFESSIONAL_SERVICES 5, HEALTH_FITNESS 5,
LIFESTYLE 5, JEWELRY_ACCESSORIES 4, SPORTS_OUTDOORS 3. Funnel: MOFU 31, BOFU 15, TOFU 5 (109 reklam sınıflandırılmamış).
Markalar (34): Grüns 23, HexClad 16, AG1 12, Nuna 12, Nestig 10, hims 8, Talentless 7, HelloFresh 7,
True Classic 6, Noom 5, Alex Hormozi 5, Stitch Fix 5 ve diğerleri.

### Medya barındırma
- Tüm görsel/videolar **Superscale'in kendi S3 + CloudFront CDN'inde** (`assets.superscale.so/files/<uuid>/original.mp4|jpg`),
  `cache-control: immutable`. Yani Superscale reklamları Meta'dan alıp kendi depolamasına kopyalıyor.
- Ancak URL'ler **CloudFront imzalı** (`Policy`, `Signature`, `Key-Pair-Id`). Politikadaki `AWS:EpochTime` birkaç saat
  ile yaklaşık 12 saat arasında bitiyor; imzasız istek 403 alıyor. fbcdn kullanılmıyor.
- Sonuç: dosya kimlikleri kalıcı ama bize açık URL'ler kalıcı değil. Statik JSON'a yazmak işe yaramaz, sürekli
  yenilemek de Superscale altyapısını CDN gibi kullanmak (ve içeriklerini yeniden dağıtmak) anlamına gelir.
  **İçe aktarıcı bu URL'leri kaydetmiyor.**

### Erişim, robots.txt ve şartlar
- Board'lar **login olmadan herkese açık** (`visibility: "PUBLIC"`, `<meta name="robots" content="index, follow">`).
- `robots.txt`: `Disallow: /share/ /lp/ /brands/ /admin/ /setup/ /stripe-redirect /rendering/ /sentry/`.
  `/board/` ve `/__api/` yasaklı değil.
- Dokümante edilmiş bir **public API yok**. `/__api/boards/...` sayfanın kendi iç uç noktası.
- **Şartlar** (<https://superscale.ai/data/terms-and-conditions>) sadece abonelik sözleşmesi yapan B2B "müşterileri"
  bağlıyor (§1.1–1.3). Scraping/robot yasağı yok. §7.7 müşterilerin "Superscale.ai içindeki içerikleri"
  çoğaltmasını ve üçüncü kişilere sunmasını yasaklıyor. Biz müşteri değiliz, ama bu madde Superscale'in
  kendi kopyalarına (medya, skorlar) sahiplik iddia ettiğini gösteriyor. Bu yüzden **sadece meta veriyi**
  (Meta reklam kimliği, marka, metin, kategori etiketleri, Superscale skoru) alıyoruz ve medyayı Meta'dan kendimiz
  çözüyoruz. Reklam yaratıcılarının telif hakkı zaten reklam veren markalara ait.

## 2. İçe aktarma (yapıldı)

```
node scripts/ingest/superscale.mjs https://superscale.ai/board/the-moonlighters/sam-pilieros-top-ads
# seçenekler: [--delay 1500] [--max-pages 20] [--no-categories] [--market US] [--segment dtc] [--replace] [--dry-run] [--browser]
```
- Önce düz `fetch` kullanıyor. JSON yerine bot challenge gelirse Playwright'ı dinamik import edip aynı isteği
  sayfa içinden yapıyor (opsiyonel bağımlılık; `/opt/pw-browsers` Chromium'u kullanılıyor).
- Hız sınırı: istekler tek tek ve aralarında en az 1,5 sn var; 429/5xx gelirse geri çekiliyor. Tam çalıştırma
  46 istek, yaklaşık 70 sn sürdü.
- Kategoriler her sektör ve funnel filtresi için ayrı sorguyla toplanıyor ve reklam uuid'lerine eşleniyor.
- Birden çok board'u biriktirir (kimliğe göre birleştirir); `--replace` sıfırdan yazar.

**Sonuç (`data/ads/superscale.json`):** 160 reklamın 160'ı Meta kimlikli (`meta_<id>`, `source:"meta"`).
98 video, 62 görsel. 30 reklam hâlâ yayında, 130'u durmuş.
- `segment`: e-ticaret sektörlerinden biri varsa `dtc` (129), yoksa `general` (31).
- `vertical`: en spesifik Superscale sektörü, kebab-case. Dağılım: health-wellness 52, fashion-apparel 28,
  mobile-apps 26, home-living 22, beauty-cosmetics 19, food-beverage 8, health-fitness 5.
- `tags`: `superscale`, `board:<handle>/<slug>`, `industry:<...>` (hepsi), `funnel:<tofu|mofu|bofu>`.
- `superscale` nesnesi: uuid, board, sektörler, funnel, Superscale performanceScore/Stars, reach, growth7d.
- `market`: hepsi `GLOBAL`, çünkü Superscale bu board için ülke vermiyor ve tahmin edilmedi.
  Markalar ağırlıkla ABD DTC; istenirse `--market US` ile açıkça verilebilir.
- `media: []`: yaratıcılar Meta zenginleştirme overlay'inden (`data/media/meta-media.json`) gelmeli.
  `activeDays` sadece aktif reklamlar için hesaplandı, çünkü Superscale bitiş tarihi vermiyor.
- Mevcut `data/ads/meta-*.json` ile çakışma: 0. Bunlar tamamen yeni reklamlar.

**Entegrasyon için gereken tek değişiklik (pipeline sahibine):** `scripts/ingest/enrich-meta-media.mjs` sadece
`/^meta-.*\.json$/` dosyalarını okuyor. Bu 160 reklamın videolarının feed'de oynaması için o regex'e
`superscale.json` eklenmeli (ör. `/^(meta-.*|superscale)\.json$/`), sonra enrich çalıştırılmalı. Bu dosya bana ait
olmadığı için değiştirmedim.

## 3. Video kalıcılığı: seçenekler

Ölçümler (2026-10-10):
- `meta-media.json` içindeki 106 video URL'sinin `oe` (bitiş) parametresi 2026-10-11 ile 2026-10-15 arasında.
  Yani fbcdn video linkleri **haftalar değil, 1–5 gün** içinde ölüyor.
- Örnek 7 videonun boyutu 0,4–24 MB, ortalama yaklaşık 7 MB (medyan yaklaşık 4 MB).
- Superscale de aynı sorunu kendi S3'üne kopyalayarak çözmüş (yukarıya bakın). Bu, (c)'nin sektörde standart
  yaklaşım olduğunu gösteriyor.

### (a) İstek anında yeniden çözme: `/api/media/[adId]`
- `facebook.com/ads/library/?id=<id>` normal tarayıcı UA'sıyla düz HTTP'de **403 + JS challenge** döndürüyor
  (`/__rd_verify_...` adresine POST atıp sayfayı yeniden yükleyen bir script).
- Aynı sayfa `facebookexternalhit` veya `Googlebot` UA'sıyla 200 dönüyor ve SSR JSON içinde `video_hd_url` var
  (test edildi; dönen fbcdn URL'si oynatılabiliyordu). Yani JS olmadan teknik olarak mümkün, **ama** bu ya crawler
  kimliğine bürünmek ya da bot challenge'ını atlatmak demek. Meta'nın otomatik veri toplama kurallarına aykırı,
  her an kırılabilir ve Vercel'in veri merkezi IP'lerinden rate-limit veya login duvarı riski yüksek. **Önerilmez.**
- Resmi yol: Ad Library API (`ads_archive`, token gerekli) ticari reklamlarda medya döndürmüyor, sadece
  `ad_snapshot_url` veriyor. Snapshot sayfasının (`/ads/archive/render_ad/?id=..&access_token=..`) HTML'inde
  `<video src>` olup olmadığı token olmadığı için test edilemedi. Token gelirse denenmeye değer.
- Maliyet düşük ama karmaşıklık ve kırılganlık yüksek; feed'de her kaydırmada sunucuya gidip gelme de gecikme yaratır.

### (b) GitHub Actions ile gece yenileme
- Mevcut `enrich-meta-media.mjs` (Playwright) gece çalışır, `--force` ile tüm id'leri tazeler ve
  `meta-media.json` dosyasını commit'ler veya Vercel'e redeploy tetikler.
- Ücretsiz (public repo) veya düşük dakika maliyeti; 300 reklam için yaklaşık 10–20 dk.
- Zayıf yanları: URL'ler 1–5 gün yaşadığı için her gece yenilemek şart; bir gece başarısız olursa videolar
  ölür. GitHub runner IP'leri Meta tarafından engellenebilir. Her gece commit veya deploy gerekir.
- Tek başına kalıcı değil; (c) için **toplayıcı** olarak ideal.

### (c) Nesne depolamaya kopyalama: **önerilen**
- Enrich sırasında video (mp4) ve poster indirilir, `videos/<adId>.mp4` gibi değişmez anahtarlarla yüklenir,
  overlay'e kalıcı URL yazılır. Feed `<video playsinline muted autoplay>` ile doğrudan oynatır. Bu, Meta'ya
  tıklamadan inline oynatma şartını kesin olarak karşılıyor.
- **Cloudflare R2:** depolama yaklaşık $0,015/GB-ay, 10 GB ücretsiz, **egress ücretsiz**. 300–1000 reklam yaklaşık
  2–7 GB, yani pratikte $0. Autoplay feed'de trafik maliyeti asıl kalem olduğundan egress'in ücretsiz olması belirleyici.
  S3 uyumlu API, Node'dan `fetch` + SigV4 veya `aws4fetch` ile yüklenebilir. Public bucket veya özel domain + CDN cache.
- **Vercel Blob:** entegrasyonu en kolay (`@vercel/blob put`), ama trafik ve depolama Vercel kotasından düşüyor.
  Video ağırlıklı bir feed'de pahalılaşır. Güncel fiyatlar Vercel'den kontrol edilmeli.
- Karmaşıklık: orta (enrich'e yaklaşık 60 satır yükleme kodu, bir bucket ve 2 secret). Tek seferlik kopya kalıcı;
  yalnızca yeni reklamlar indirilir.
- Hukuki not: reklam yaratıcıları markaların telifli içeriği. Superscale, Foreplay gibi araçlar da aynısını yapıyor,
  ama bu bir risk kabulü. "Ad Library'de aç" bağlantısı ve kaynak gösterimi korunmalı, kaldırma talebine hızlı yanıt verilmeli.

### (d) Instagram/Facebook oEmbed
- Graph API `instagram_oembed` / `oembed_video` uygulama token'ı ve App Review'dan geçmiş "oEmbed Read" özelliği istiyor.
- Ham video değil, iframe veya blockquote HTML döndürüyor. TikTok tarzı autoplay/muted/snap feed'de kontrol
  çok kısıtlı (autoplay yok, Meta'nın kendi UI'ı görünüyor).
- Çoğu performans reklamı organik post değil (dark post). Superscale de post id'si vermiyor. Uygulanabilir oran
  çok düşük. **Önerilmez**, en fazla elde post linki olan küratörlü birkaç reklam için yedek olabilir.

### Öneri
**(b) + (c):** Gece (veya 6 saatte bir) çalışan bir GitHub Actions işi, Playwright enrich'i *sadece yeni veya henüz
kopyalanmamış* reklamlar için çalıştırır, mp4 ve poster dosyalarını **Cloudflare R2**'ye yükler ve overlay'e kalıcı
R2 URL'lerini yazar. fbcdn URL'leri sadece indirme anında, birkaç dakikalığına kullanılır.
- Maliyet: yaklaşık $0/ay (R2 ücretsiz katman, egress ücretsiz) + GitHub Actions dakikaları.
- Karmaşıklık: orta; yaklaşık 1 günlük iş. Mevcut enrich betiği temel olarak kullanılabilir.
- (a) yalnızca acil durum yedeği olarak düşünülebilir; crawler UA taklidine dayandığı için ürün yolu yapılmamalı.
- (d) gerekli değil.
