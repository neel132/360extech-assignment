import { z } from "zod";
import { cohort } from "@/lib/analytics";
import { timed } from "@/lib/events";

const Profile = z.object({
  age: z.number().min(18).max(100),
  gender: z.enum(["Male", "Female", "Other"]),
  bmi: z.number().min(12).max(60),
  physical_activity_minutes_per_week: z.number().min(0).max(1500),
  diet_score: z.number().min(0).max(10),
  sleep_hours_per_day: z.number().min(2).max(14),
  screen_time_hours_per_day: z.number().min(0).max(18),
  alcohol_consumption_per_week: z.number().min(0).max(40),
  smoking_status: z.enum(["Never", "Former", "Current"]),
  family_history_diabetes: z.union([z.literal(0), z.literal(1)]),
  hypertension_history: z.union([z.literal(0), z.literal(1)]),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return timed("cohort", () => cohort(Profile.parse(body)));
}
