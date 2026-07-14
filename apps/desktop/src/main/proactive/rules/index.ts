import { type ProactiveRule } from '../types';
import { meetingLead } from './meetingLead';
import { tomorrowPreview } from './tomorrowPreview';
import { overdueTodos } from './overdueTodos';
import { needsReply } from './needsReply';
import { weatherHeadsUp } from './weatherHeadsUp';

/**
 * The engine discovers rules from this array (F3.3). Adding a rule later requires
 * only a new file here plus its strings.
 */
export const BUILTIN_RULES: ProactiveRule[] = [meetingLead, tomorrowPreview, overdueTodos, needsReply, weatherHeadsUp];

export { meetingLead, tomorrowPreview, overdueTodos, needsReply, weatherHeadsUp };
