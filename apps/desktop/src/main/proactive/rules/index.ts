import { type ProactiveRule } from '../types';
import { meetingLead } from './meetingLead';
import { tomorrowPreview } from './tomorrowPreview';
import { overdueTodos } from './overdueTodos';

/**
 * The engine discovers rules from this array (F3.3). Adding a rule later requires
 * only a new file here plus its strings. needs_reply + weather_heads_up (6.4)
 * are appended once built.
 */
export const BUILTIN_RULES: ProactiveRule[] = [meetingLead, tomorrowPreview, overdueTodos];

export { meetingLead, tomorrowPreview, overdueTodos };
