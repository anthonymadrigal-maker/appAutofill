/**
 * Matching heuristics that map a form field's on-page text (its label,
 * placeholder, name/id attributes, aria attributes, nearby heading, etc.)
 * to a key in PROFILE_SCHEMA.
 *
 * content.js normalizes each field's combined signal text to lowercase,
 * inserts spaces at camelCase/kebab-case/snake_case boundaries, and
 * collapses punctuation to spaces before testing it against these
 * regexes. That normalization is what lets one generic rule set cover
 * hand-written labels ("First Name") as well as framework-generated
 * attributes (id="firstName", name="first_name", data-automation-id
 *="legalName--firstName") across Greenhouse, Lever, Workday, and
 * plain hand-rolled forms, without hardcoding brittle per-site ids.
 *
 * FIELD_MATCH_ORDER controls precedence: it's checked top to bottom and
 * the first key whose rule matches "wins" a given field, so narrower /
 * more specific keys must be listed before broader ones (e.g. addressZip
 * before addressStreet, firstName before the derived fullName check).
 */

const FIELD_RULES = {
  firstName: [/\bfirst\s*name\b/, /\bgiven\s*name\b/, /\bfname\b/],
  lastName: [/\blast\s*name\b/, /\bsur\s*name\b/, /\bfamily\s*name\b/, /\blname\b/],
  preferredName: [/\bpreferred\s*name\b/, /\bnick\s*name\b/, /\bgo\s*by\b/, /\bpreferred\s*first\s*name\b/],

  email: [/\be[\s-]?mail\b/],
  phone: [/\bphone\b/, /\bmobile\b/, /\btelephone\b/, /\bcell\s*number\b/, /\bcontact\s*number\b/],

  addressZip: [/\bzip\b/, /\bpostal\s*code\b/, /\bpost\s*code\b/],
  addressState: [/\bstate\b/, /\bprovince\b/, /\bregion\b(?!.*(country|world))/],
  addressCity: [/\bcity\b/, /\btown\b/],
  addressCountry: [/\bcountry\b/, /\bnation(ality)?\b/],
  addressStreet: [/\baddress\s*line\s*1\b/, /\bstreet\s*address\b/, /\bmailing\s*address\b/, /\bstreet\b/, /\baddress\b/],

  linkedin: [/\blinked\s*in\b/],
  github: [/\bgit\s*hub\b/],
  portfolio: [/\bportfolio\b/, /\bpersonal\s*website\b/, /\bwebsite\b/, /\bother\s*url\b/],

  // "college" alone is too common in unrelated questions (e.g. "current
  // year of study in college"), so it only counts here alongside a word
  // that means "which one do you attend" / "what is its name".
  school: [
    /\bschool\b/, /\buniversity\b/, /\binstitution\b/, /\balma\s*mater\b/,
    /\b(college|university)\s*(name)?\b.*\b(attend|currently\s*attend)\b/,
    /\bname\s*of\s*the\s*(college|university)\b/,
    /\bwhat\s*college\b/, /\bwhich\s*college\b/
  ],
  gpaScale: [/\bgpa\s*scale\b/, /\bscale\s*max\b/],
  gpa: [/\bgpa\b/, /\bgrade\s*point\s*average\b/],
  major: [/\bmajor\b/, /\bfield\s*of\s*study\b/, /\barea\s*of\s*study\b/, /\bconcentration\b/, /\bdiscipline\b/],
  minor: [/\bminor\b/],
  graduationMonth: [/\bgraduation\s*month\b/, /\bgrad\s*month\b/],
  // Checked before "degree" below: phrasing like "what year ... will you
  // receive your degree" contains the word "degree" too, and must resolve
  // to a year, not to the degree-level select.
  graduationYear: [
    /\bgraduation\s*year\b/, /\bgrad\s*year\b/, /\bclass\s*of\b/, /\banticipated\s*graduation\b/,
    /\byear\b.*\b(receive|complete|earn|finish)\b.*\bdegree\b/,
    /\bwhat\s*year\b.*\bgraduat/
  ],
  graduationDate: [/\bgraduation\s*date\b/, /\bexpected\s*graduation\b/, /\banticipated\s*grad(uation)?\s*date\b/],
  degree: [/\bdegree\s*type\b/, /\bdegree\b/, /\beducation\s*level\b/, /\blevel\s*of\s*education\b/],

  currentlyWorking: [/\bcurrently\s*work\s*here\b/, /\bi\s*currently\s*work\b/, /\bthis\s*is\s*my\s*current\s*(job|position|employer)\b/],
  employer: [/\bcurrent\s*employer\b/, /\bmost\s*recent\s*employer\b/, /\bemployer\s*name\b/, /\bemployer\b/, /\bcompany\s*name\b/],
  jobTitle: [/\bjob\s*title\b/, /\bposition\s*title\b/, /\bcurrent\s*title\b/, /\brole\s*title\b/],
  workStartDate: [/\bemployment\s*start\s*date\b/, /\bwork\s*start\s*date\b/, /\bjob\s*start\s*date\b/],
  workEndDate: [/\bemployment\s*end\s*date\b/, /\bwork\s*end\s*date\b/, /\bjob\s*end\s*date\b/],
  workDescription: [/\bresponsibilit(y|ies)\b/, /\bjob\s*duties\b/, /\bdescription\s*of\s*(work|role|duties)\b/, /\bsummary\s*of\s*experience\b/],

  usCitizen: [/\bu\.?\s*s\.?\s*citizen\b/, /\bcitizen\s*of\s*the\s*united\s*states\b/, /\bare\s*you\s*a\s*citizen\b/],
  needsSponsorship: [/\bsponsorship\b/, /\bsponsor(ed)?\s*(now|future)?\s*visa\b/, /\brequire\s*sponsor/],
  workAuthorized: [/\bauthorized\s*to\s*work\b/, /\blegally\s*(eligible|authorized|permitted)\b/, /\bwork\s*authorization\b/, /\beligib(le|ility)\s*to\s*work\b/],
  over18: [/\b18\s*years\s*(of\s*age|old)\b/, /\bat\s*least\s*18\b/, /\bage\s*of\s*majority\b/],
  felonyConviction: [/\bfelony\b/, /\bconvicted\s*of\s*a\s*crime\b/, /\bcriminal\s*(history|record|conviction)\b/],
  nonCompete: [/\bnon[\s-]?compete\b/, /\bnoncompete\b/],

  hispanicLatino: [/\bhispanic\b/, /\blatino\b/, /\blatinx\b/, /\blatina\b/],
  race: [/\brace\b/, /\bethnicity\b/, /\bracial\b/],
  veteranStatus: [/\bveteran\b/, /\bmilitary\s*status\b/, /\barmed\s*forces\b/],
  disabilityStatus: [/\bdisability\b/, /\bdisabled\b/, /\bdifferently\s*abled\b/],
  gender: [/\bgender\s*identity\b/, /\bgender\b/, /\bsex\b(?!ual)/],

  desiredSalary: [
    /\bdesired\s*salary\b/, /\bexpected\s*salary\b/, /\bsalary\s*expect/, /\bcompensation\s*expect/,
    /\bpay\s*expect/, /\bsalary\s*requirement/, /\b(salary|wage|compensation|pay)\b.*\brequir/
  ],
  availableStartDate: [
    /\bwhen\s*can\s*you\s*start\b/, /\bavailab(le|ility)\s*(to\s*start|date)\b/, /\bdate\s*availab(le|ility)\b/,
    /\bearliest\s*start\s*date\b/, /\bstart\s*date\b/
  ],
  willingToRelocate: [/\brelocat(e|ion)\b/],
  remotePreference: [/\bremote\b/, /\bwork\s*(location|arrangement)\s*preference\b/, /\blocation\s*preference\b/, /\bonsite\s*or\s*remote\b/],
  noticePeriod: [/\bnotice\s*period\b/],
  howHeard: [/\bhow\s*did\s*you\s*hear\b/, /\breferral\s*source\b/, /\bhear\s*about\s*(us|this|the\s*role|the\s*position)\b/],

  fullName: [/\bfull\s*name\b/, /\blegal\s*name\b/, /\byour\s*name\b/, /^\s*name\s*$/, /\bapplicant\s*name\b/]
};

// Most specific / narrow first, broadest last. Any key not listed here
// is matched in the (arbitrary) order Object.keys() returns.
const FIELD_MATCH_ORDER = [
  "firstName", "lastName", "preferredName",
  "email", "phone",
  "addressZip", "addressState", "addressCity", "addressCountry", "addressStreet",
  "linkedin", "github", "portfolio",
  "school", "gpaScale", "gpa", "major", "minor",
  "graduationMonth", "graduationYear", "graduationDate", "degree",
  "currentlyWorking", "employer", "jobTitle", "workStartDate", "workEndDate", "workDescription",
  "usCitizen", "needsSponsorship", "workAuthorized", "over18", "felonyConviction", "nonCompete",
  "hispanicLatino", "race", "veteranStatus", "disabilityStatus", "gender",
  "desiredSalary", "availableStartDate", "willingToRelocate", "remotePreference", "noticePeriod", "howHeard",
  "fullName"
];

// Words that flip a single (non-grouped) yes/no checkbox's polarity, e.g.
// a checkbox labeled "I am NOT subject to a non-compete agreement".
const NEGATION_PATTERN = /\b(not|n't|never|without|decline|no\s)\b/;

// Matches follow-up fields that only make sense if a *different* question
// was answered a particular way, e.g. "If you responded 'yes' to the prior
// statement, please indicate the name of the former employer..." next to a
// legal/compliance Yes-No question. These are always skipped: filling one
// in from an unrelated profile field (e.g. dropping your current employer's
// name into a non-compete disclosure) can misrepresent a legal answer you
// never actually gave. Left for the applicant to answer by hand.
const CONDITIONAL_FOLLOWUP_PATTERN = /\bif\s*(you\s*)?(responded|answered|selected|select)\b|\bi\s*responded\b|\bif\s*(yes|no|so|applicable)\b/;

if (typeof module !== "undefined" && module.exports) {
  module.exports = { FIELD_RULES, FIELD_MATCH_ORDER, NEGATION_PATTERN, CONDITIONAL_FOLLOWUP_PATTERN };
}
