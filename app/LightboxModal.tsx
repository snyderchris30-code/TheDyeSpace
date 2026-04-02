import React, { useEffect } from "react";

interface LightboxModalProps {
  imageUrl: string;
  onClose: () => void;
}

export default function LightboxModal({ imageUrl, onClose }: LightboxModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/90 backdrop-blur-sm cosmic-glow">
      <button
        className="absolute top-6 right-8 text-white text-3xl font-bold bg-black/60 rounded-full p-2 hover:bg-black/80 focus:outline-none"
        aria-label="Close"
        onClick={onClose}
      >
        ×
      </button>
      <div className="max-w-4xl w-full h-full flex items-center justify-center">
        <img
          src={imageUrl}
          alt="Zoomed post"
          className="max-h-[80vh] max-w-full rounded-2xl shadow-2xl object-contain cursor-zoom-in touch-none"
        />
      </div>
    </div>
  );
}
