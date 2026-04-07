import AsyncStateCard from "@/app/AsyncStateCard";

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <AsyncStateCard
          loading
          title="Loading TheDyeSpace"
          message="Pulling together posts, profiles, and chat updates so the page is ready to use."
        />
      </div>
    </div>
  );
}