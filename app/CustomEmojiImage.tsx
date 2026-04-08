import { buildCustomEmojiSrc } from "@/lib/custom-emojis";
type CustomEmojiImageProps = {
  src: string;
  alt?: string;
  className?: string;
  title?: string;
};

export default function CustomEmojiImage({ src, alt = "custom emoji", className, title }: CustomEmojiImageProps) {
  const safeSrc = buildCustomEmojiSrc(src);
  const defaultSize = 32;

  return (
    <img
      src={safeSrc}
      alt={alt}
      className={`${className ?? ""} inline-block object-contain`}
      title={title}
      width={defaultSize}
      height={defaultSize}
      loading="lazy"
      decoding="async"
    />
  );
}