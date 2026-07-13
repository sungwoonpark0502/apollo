import { z } from 'zod';
import { type CardPayload, type ToolCtx, type ToolDef, type ToolResult } from '@apollo/shared';

/**
 * brief.daily (C7 composite): runs calendar.list(today) + email triage (if
 * connected) + weather.now + news.brief, then composes one spoken paragraph
 * (max 4 sentences) plus a BriefCard stack. Sub-tool failures degrade with a
 * WARNING naming the section, never aborting the brief.
 */
export interface BriefDeps {
  getTool: (name: string) => ToolDef | undefined;
  emailConnected: () => boolean;
}

async function runSub(
  deps: BriefDeps,
  name: string,
  args: Record<string, unknown>,
  ctx: ToolCtx,
): Promise<ToolResult | null> {
  const tool = deps.getTool(name);
  if (!tool) return null;
  try {
    const parsed = tool.params.safeParse(args);
    if (!parsed.success) return null;
    return await tool.execute(parsed.data, ctx);
  } catch {
    return { llmText: `WARNING ${name} was unavailable.` };
  }
}

function firstSentence(text: string): string {
  const clean = text.replace(/^(ERROR|WARNING)\s+/i, '').trim();
  const m = clean.match(/^[^.!?]*[.!?]/);
  return (m ? m[0] : clean).trim();
}

export function createBriefTool(deps: BriefDeps): ToolDef {
  const params = z.object({});
  return {
    name: 'brief.daily',
    tier: 1,
    networked: true,
    description:
      'Give the user their daily brief: today\'s calendar, weather, top news, and (if email is connected) unread highlights. Use for "good morning" or "what\'s my day".',
    params,
    async execute(_args, ctx): Promise<ToolResult> {
      const sections: CardPayload[] = [];
      const spoken: string[] = [];
      const warnings: string[] = [];

      const [calendar, weather, news, email] = await Promise.all([
        runSub(deps, 'calendar.list', {}, ctx), // defaults to today
        runSub(deps, 'weather.now', {}, ctx),
        runSub(deps, 'news.brief', {}, ctx),
        deps.emailConnected() ? runSub(deps, 'email.list', { query: 'is:unread' }, ctx) : Promise.resolve(null),
      ]);

      // Calendar
      if (calendar?.card) sections.push(calendar.card);
      if (calendar) {
        if (calendar.llmText.startsWith('WARNING')) warnings.push('calendar');
        else spoken.push(firstSentence(calendar.llmText));
      }

      // Weather
      if (weather?.card) sections.push(weather.card);
      if (weather) {
        if (weather.llmText.startsWith('WARNING') || weather.llmText.startsWith('ERROR')) warnings.push('weather');
        else spoken.push(firstSentence(weather.llmText));
      }

      // Email triage (highlights only; content stays untrusted)
      let untrusted = false;
      if (email?.card) {
        sections.push(email.card);
        untrusted = untrusted || email.untrusted === true;
        if (email.card.kind === 'emailList') {
          const unread = email.card.items.filter((m) => m.unread).length;
          if (unread > 0) spoken.push(`You have ${unread} unread email${unread === 1 ? '' : 's'}.`);
        }
      }

      // News
      if (news?.card) {
        sections.push(news.card);
        untrusted = untrusted || news.untrusted === true;
      }
      if (news) {
        if (news.llmText.startsWith('WARNING') || news.llmText.startsWith('ERROR')) warnings.push('news');
        else if (news.card?.kind === 'newsList') spoken.push(`Top story: ${news.card.items[0]?.title ?? 'nothing new'}.`);
      }

      const paragraph = spoken.slice(0, 4).join(' ') || 'Not much to report this morning.';
      const warningText = warnings.length ? ` (Couldn't reach: ${warnings.join(', ')}.)` : '';

      return {
        // A complete spoken brief in ≤4 sentences: usable directly by the fast
        // path / scheduler, and as tool context when the LLM is summarizing.
        llmText: paragraph + warningText,
        card: { kind: 'brief', sections },
        untrusted: untrusted || undefined,
      };
    },
  };
}
