type CustomEmojiImageProps = {
  src: string;
  alt?: string;
  className?: string;
  title?: string;
};

export default function CustomEmojiImage({ src, alt = "custom emoji", className, title }: CustomEmojiImageProps) {
  return <img src={src} alt={alt} className={className} loading="lazy" title={title} />;
}