/**
 * Shared profile schema used by options.js (renders the editor),
 * popup.js (shows a summary), and content.js (knows what each
 * profile key means when it isn't just filling raw text).
 *
 * Loaded as a plain script (no modules) so it can be listed directly
 * in manifest.json's content_scripts and in options.html / popup.html.
 */

const STORAGE_KEY = "internshipAutofillProfile";

// type: "text" | "email" | "tel" | "url" | "textarea" | "select" | "yesno"
const PROFILE_SCHEMA = [
  {
    id: "personal",
    title: "Personal Information",
    fields: [
      { key: "firstName", label: "First Name", type: "text" },
      { key: "lastName", label: "Last Name", type: "text" },
      { key: "preferredName", label: "Preferred / Nickname", type: "text" },
      { key: "email", label: "Email", type: "email" },
      { key: "phone", label: "Phone Number", type: "tel" },
      { key: "addressStreet", label: "Street Address", type: "text" },
      { key: "addressCity", label: "City", type: "text" },
      { key: "addressState", label: "State / Province", type: "text" },
      { key: "addressZip", label: "ZIP / Postal Code", type: "text" },
      { key: "addressCountry", label: "Country", type: "text", default: "United States" },
      { key: "linkedin", label: "LinkedIn URL", type: "url" },
      { key: "github", label: "GitHub URL", type: "url" },
      { key: "portfolio", label: "Portfolio / Personal Website", type: "url" }
    ]
  },
  {
    id: "education",
    title: "Education",
    fields: [
      { key: "school", label: "School / University", type: "text" },
      {
        key: "degree",
        label: "Degree Level",
        type: "select",
        options: [
          "High School Diploma",
          "Associate's Degree",
          "Bachelor's Degree",
          "Master's Degree",
          "Doctorate (PhD)",
          "Other"
        ]
      },
      { key: "major", label: "Major / Field of Study", type: "text" },
      { key: "minor", label: "Minor (optional)", type: "text" },
      {
        key: "classStanding",
        label: "Class Standing / Year in School",
        type: "select",
        options: [
          "Freshman", "Sophomore", "Junior", "Senior",
          "Graduate / Master's Student", "PhD Candidate", "Recent Graduate"
        ]
      },
      { key: "gpa", label: "GPA", type: "text" },
      { key: "gpaScale", label: "GPA Scale", type: "text", default: "4.0" },
      {
        key: "graduationMonth",
        label: "Expected Graduation Month",
        type: "select",
        options: [
          "January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"
        ]
      },
      { key: "graduationYear", label: "Expected Graduation Year", type: "text" }
    ]
  },
  {
    id: "work",
    title: "Most Recent Work Experience",
    fields: [
      { key: "employer", label: "Employer", type: "text" },
      { key: "jobTitle", label: "Job Title", type: "text" },
      { key: "workStartDate", label: "Start Date", type: "text", placeholder: "MM/YYYY" },
      { key: "workEndDate", label: "End Date", type: "text", placeholder: "MM/YYYY or Present" },
      { key: "currentlyWorking", label: "I currently work here", type: "yesno" },
      { key: "workDescription", label: "Description / Responsibilities", type: "textarea" }
    ]
  },
  {
    id: "authorization",
    title: "Work Authorization & Eligibility",
    fields: [
      { key: "usCitizen", label: "Are you a U.S. citizen?", type: "yesno" },
      { key: "workAuthorized", label: "Are you legally authorized to work in the country where this job is located?", type: "yesno" },
      { key: "needsSponsorship", label: "Will you now or in the future require sponsorship for employment visa status?", type: "yesno" },
      { key: "over18", label: "Are you at least 18 years old?", type: "yesno" },
      { key: "felonyConviction", label: "Have you ever been convicted of a felony?", type: "yesno" },
      { key: "nonCompete", label: "Are you subject to a non-compete agreement?", type: "yesno" },
      { key: "previouslyEmployedHere", label: "Have you previously been employed by this company?", type: "yesno" },
      { key: "governmentEmployee", label: "Are you currently a government employee, or have you been in the past (includes military service)?", type: "yesno" },
      { key: "consentBackgroundCheck", label: "Do you consent to a background check?", type: "yesno" },
      { key: "securityClearanceEligible", label: "Are you eligible to obtain a security clearance?", type: "yesno" },
      { key: "securityClearanceGranted", label: "Have you ever been granted a security clearance?", type: "yesno" },
      { key: "clearanceLevel", label: "Level of Clearance (if applicable)", type: "text" }
    ]
  },
  {
    id: "eeo",
    title: "Voluntary Self-Identification (EEO)",
    description: "These questions are voluntary on most applications. Leave any of them blank if you'd rather answer manually or decline each time.",
    fields: [
      {
        key: "gender",
        label: "Gender",
        type: "select",
        options: ["Male", "Female", "Non-Binary", "Decline to answer"]
      },
      {
        key: "hispanicLatino",
        label: "Are you Hispanic or Latino?",
        type: "yesno"
      },
      {
        key: "race",
        label: "Race / Ethnicity",
        type: "select",
        options: [
          "American Indian or Alaska Native",
          "Asian",
          "Black or African American",
          "Native Hawaiian or Other Pacific Islander",
          "White",
          "Two or More Races",
          "Decline to answer"
        ]
      },
      {
        key: "veteranStatus",
        label: "Veteran Status",
        type: "select",
        options: [
          "I am not a protected veteran",
          "I identify as a protected veteran",
          "I don't wish to answer"
        ]
      },
      {
        key: "disabilityStatus",
        label: "Disability Status",
        type: "select",
        options: [
          "Yes, I have a disability (or previously had one)",
          "No, I do not have a disability",
          "I don't wish to answer"
        ]
      }
    ]
  },
  {
    id: "logistics",
    title: "Referral & Logistics",
    fields: [
      { key: "referredByEmployee", label: "Were you referred by a current employee?", type: "yesno" },
      { key: "referrerName", label: "Referring Employee's Name", type: "text" },
      { key: "willingToTravel", label: "Willing to travel for this role?", type: "yesno" },
      { key: "travelPercentage", label: "Percentage of Travel You'll Accept", type: "text", placeholder: "e.g. 25%" },
      { key: "validDriversLicense", label: "Do you have a valid driver's license?", type: "yesno" },
      {
        key: "preferredRegion",
        label: "Preferred U.S. Region",
        type: "select",
        options: ["Northeast", "Southeast", "Southwest", "West", "Midwest", "Any"]
      }
    ]
  },
  {
    id: "preferences",
    title: "Preferences",
    fields: [
      { key: "desiredSalary", label: "Desired Salary / Compensation", type: "text" },
      { key: "availableStartDate", label: "Available Start Date", type: "text" },
      { key: "willingToRelocate", label: "Willing to Relocate?", type: "yesno" },
      {
        key: "remotePreference",
        label: "Work Location Preference",
        type: "select",
        options: ["Remote", "Hybrid", "On-site", "No preference"]
      },
      { key: "howHeard", label: "How did you hear about us?", type: "text" },
      { key: "noticePeriod", label: "Notice Period", type: "text" }
    ]
  }
];

function buildDefaultProfile() {
  const profile = {};
  for (const section of PROFILE_SCHEMA) {
    for (const field of section.fields) {
      profile[field.key] = field.default !== undefined ? field.default : "";
    }
  }
  return profile;
}

// Shared across service worker, options page, popup, and content script.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { STORAGE_KEY, PROFILE_SCHEMA, buildDefaultProfile };
}
