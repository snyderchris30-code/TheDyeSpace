import Image from "next/image";
type CustomEmojiImageProps = {
  src: string;
  alt?: string;
  className?: string;
  title?: string;
};

export default function CustomEmojiImage({ src, alt = "custom emoji", className, title }: CustomEmojiImageProps) {
  // Always encode emoji filenames for URLs, preserving folder separators
  const safeSrc = src.startsWith('/emojis/')
    ? `/emojis/${src
        .replace(/^\/emojis\//, '')
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')}`
    : encodeURI(src);
  // Default size for emoji images if not overridden
  const defaultSize = 32;
  return (
    <Image
      src={safeSrc}
      alt={alt}
      className={className}
      title={title}
      width={defaultSize}
      height={defaultSize}
      style={{ width: defaultSize, height: defaultSize, objectFit: 'contain', ...((className ? {} : { display: 'inline-block' })) }}
      loading="lazy"
      decoding="async"
      unoptimized
    />
  );
}