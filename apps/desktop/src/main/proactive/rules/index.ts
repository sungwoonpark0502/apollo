import { type ProactiveRule } from '../types';
import { meetingLead } from './meetingLead';
import { tomorrowPreview } from './tomorrowPreview';
import { needsReply } from './needsReply';
import { weatherHeadsUp } from './weatherHeadsUp';

/**
 * The engine discovers rules from this array (F3.3). Adding a rule later requires
 * only a new file here plus its strings.
 */
// L2: overdueTodos is removed with the To-dos surface.
export const BUILTIN_RULES: ProactiveRule[] = [meetingLead, tomorrowPreview, needsReply, weatherHeadsUp];

export { meetingLead, tomorrowPreview, needsReply, weatherHeadsUp };
