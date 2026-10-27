import { Clock3 } from "lucide-react";
import { AuthControl } from "@/components/auth-controls";

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center bg-stone-50 px-6 py-16">
      <section className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-8 shadow-sm sm:p-10">
        <div className="mb-10 flex items-center gap-3 font-semibold tracking-tight">
          <span className="rounded-xl bg-emerald-900 p-2 text-white"><Clock3 size={22} /></span>
          Timeclock
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Make time for your work.</h1>
        <p className="mb-8 mt-4 leading-7 text-stone-600">One place for your projects, tasks, and the time you spend on them.</p>
        {error && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">Sign-in wasn’t completed. Use the Google account configured for this app, or try again.</p>}
        <AuthControl action="signin" />
        <p className="mt-6 text-xs leading-5 text-stone-500">Your private workspace. Access is limited to your account.</p>
      </section>
    </main>
  );
}
