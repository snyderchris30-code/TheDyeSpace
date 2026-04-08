type CustomEmojiImageProps = {
  src: string;
  alt?: string;
  className?: string;
  title?: string;
};

export default function CustomEmojiImage({ src, alt = "custom emoji", className, title }: CustomEmojiImageProps) {
  // Always encode emoji filenames for URLs
  const safeSrc = src.startsWith('/emojis/')
    ? `/emojis/${encodeURIComponent(src.replace(/^\/emojis\//, ''))}`
    : encodeURI(src);
  // Default size for emoji images if not overridden
  const defaultSize = 32;
  return (
    <img
      src={safeSrc}
      alt={alt}
      className={className}
      loading="lazy"
      title={title}
      width={defaultSize}
      height={defaultSize}
      decoding="async"
      style={{ width: defaultSize, height: defaultSize, objectFit: 'contain', ...((className ? {} : { display: 'inline-block' })) }}
    />
  );
}