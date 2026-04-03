import dynamic from "next/dynamic";

const GlobalChatClient = dynamic(() => import("./GlobalChatClient"), { ssr: false });

export default function Page() {
  return <GlobalChatClient />;
}
