import { buildCustomEmojiSrc, parseEmojiTextSegments } from "@/lib/custom-emojis";

type InlineEmojiTextProps = {
  text: string;
  className?: string;
};

export default function InlineEmojiText({ text, className }: InlineEmojiTextProps) {
  const segments = parseEmojiTextSegments(text);

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <span key={`txt-${index}`}>{segment.value}</span>;
        }

        return (
          <img
            key={`emoji-${index}-${segment.url}`}
            src={buildCustomEmojiSrc(segment.url)}
            alt="custom emoji"
            className="mx-0.5 inline-block h-5 w-5 object-contain align-text-bottom"
            width={20}
            height={20}
            loading="lazy"
            decoding="async"
          />
        );
      })}
    </span>
  );
}
