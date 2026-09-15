-- Fotos y videos del producto como lista ordenada. Reemplaza el CSV que se
-- guardaba en photo_url y la columna video_poster_url, que nunca se usó
-- (la portada del video sale del primer cuadro, ver mediaElementSrc).
alter table public.products
  add column media_urls text[] not null default '{}';

update public.products
  set media_urls = array_remove(string_to_array(photo_url, ','), '')
  where photo_url is not null;

-- Límite espejado en PRODUCT_MEDIA_LIMIT (packages/shared/src/product-media.ts).
alter table public.products
  add constraint products_media_urls_limit check (cardinality(media_urls) <= 3);

alter table public.products
  drop column photo_url,
  drop column video_poster_url;
