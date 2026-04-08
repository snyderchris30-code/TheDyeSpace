import Image from "next/image";
import { parseEmojiTextSegments } from "@/lib/custom-emojis";

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
          <Image
            key={`emoji-${index}-${segment.url}`}
            src={segment.url}
            alt="custom emoji"
            className="mx-0.5 inline-block h-5 w-5 align-text-bottom"
            width={20}
            height={20}
            style={{ width: 20, height: 20, objectFit: 'contain', display: 'inline-block', verticalAlign: 'text-bottom' }}
            loading="lazy"
            decoding="async"
          />
        );
      })}
    </span>
  );
}
