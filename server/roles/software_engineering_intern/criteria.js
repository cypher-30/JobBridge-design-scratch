// Ported from hiring-agent's roles/software_engineering_intern/criteria.jinja
// (HackerRank's open-sourced resume scorer, PR #375 "role-agnostic scoring").
// The trailing "respond with this exact JSON" block from the original is
// dropped here — JobBridge enforces the output shape via the LLM schema
// (see server/llm/scoreCv.js), matching the convention parseCv.js/matchJob.js
// already use, so it doesn't need to be repeated in the prompt text.
const CRITERIA_BODY = `You are evaluating a resume for a Software Intern position. Analyze the resume data and provide scores based on these criteria:

**MANDATORY: You MUST always fill ALL FOUR categories: open_source, self_projects, production, technical_skills.**

## CRITICAL FAIRNESS REQUIREMENTS
**SCORES MUST NEVER DEPEND ON:**
- Candidate's name, gender, or personal demographic information
- College, university, or educational institution name
- CGPA, GPA, or academic grades
- City, location, or geographical information
- Any personal characteristics unrelated to technical skills and experience

**EVALUATION MUST BE BASED ONLY ON:**
- Technical skills and programming languages
- Project complexity and real-world impact
- Open source contributions and community involvement
- Work experience and production-level contributions
- Technical communication and documentation abilities
- Problem-solving and algorithmic thinking demonstrated in projects

## PROGRAM DISTINCTIONS
- "Google Summer of Code (GSoC)" and "Girl Script Summer of Code" are COMPLETELY DIFFERENT programs
- NEVER use "GSoC" as shorthand for "Girl Script Summer of Code"
- When you see "Girl Script Summer of Code" in the resume, refer to it as "Girl Script Summer of Code"
- When you see "Google Summer of Code" in the resume, refer to it as "Google Summer of Code (GSoC)"

## ANALYSIS INSTRUCTIONS
- Analyze the structured resume/CV data provided (skills, experience, education, projects)
- Use GitHub data (if provided in === GITHUB DATA === section) as additional context

## SCORING CRITERIA

### Open Source (0-35 points)
**HIGH SCORES (25-35 points):**
- Contributions to popular open source projects (1000+ stars)
- Significant contributions to well-known projects
- Google Summer of Code (GSoC) participation
- Substantial community involvement

**MEDIUM SCORES (15-24 points):**
- Contributions to smaller open source projects
- Active GitHub presence with meaningful contributions to other repositories
- Participation in open source programs

**LOW SCORES (5-10 points):**
- Only personal GitHub repositories with no contributions to other projects
- Minimal open source activity
- Basic GitHub presence
- **CRITICAL**: Hacktoberfest participation alone (without evidence of contributions to significant projects) should receive 3-5 points maximum

**VERY LOW SCORES (0-4 points):**
- No GitHub presence
- Only very basic personal repositories
- Repositories that are clearly tutorial-based with no community involvement

**CRITICAL RULES:**
- Having personal GitHub repositories does NOT constitute open source contribution
- True open source contribution means contributing to OTHER people's projects
- When GitHub data shows all projects are 'self_project' type, open source score MUST be 10 points or less

### Self Projects (0-30 points)
**HIGH SCORES (20-30 points):**
- Complex projects with real-world impact
- Advanced architecture, multiple technologies
- User adoption or contributions to popular open source projects

**MEDIUM SCORES (10-19 points):**
- Projects with some complexity, good documentation
- Multiple features or moderate technical challenge

**LOW SCORES (1-9 points):**
- Simple tutorial projects (todo lists, calculators, basic CRUD apps, weather apps, note-taking apps, recipe apps, exercise apps)
- Basic sentiment analysis using standard libraries (NLTK, scikit-learn)
- Classroom assignments or projects with minimal technical complexity

**ZERO SCORES (0 points):**
- No projects or only extremely basic projects that demonstrate no technical skills

**PROJECT LINK REQUIREMENTS:**
- **NO LINKS**: Projects without URLs, GitHub links, or live demos should receive 30-50% lower scores
- **INACTIVE LINKS**: Projects with broken links should receive 20-30% lower scores
- **LIVE DEMO BONUS**: Projects with working live demos should receive 10-20% higher scores

### Production (0-25 points)
- Analyze work/internship/volunteer experience for real-world or production experience
- **SPECIAL CONSIDERATION**: Give extra points for founder roles, co-founder positions, or early-stage engineer roles (first 10-20 employees) at startups

### Technical Skills (0-10 points)
- Analyze skills, languages, and evidence of technical breadth or problem-solving in projects, work, or competitions

## PROJECT COMPLEXITY ASSESSMENT

**Simple/Basic Projects (Low Impact):**
- Todo list applications, calculators, basic CRUD applications
- Weather apps using public APIs, note-taking applications
- Simple portfolio websites, basic form applications
- "Hello World" applications, classroom assignment projects
- Tutorial-based projects, recipe sharing applications
- Exercise/health apps using public APIs
- Basic sentiment analysis using standard libraries
- Simple e-commerce applications, basic social media clones

**Complex/Advanced Projects (High Impact):**
- Full-stack applications with multiple features
- Projects with user authentication and databases
- Machine learning or AI applications
- Real-time applications (chat, streaming, etc.)
- Mobile applications with native features
- Projects with microservices architecture
- Contributions to popular open source projects
- Projects with significant user adoption
- Projects solving real-world problems
- Projects demonstrating advanced algorithms or data structures

## BONUS POINTS (Maximum total: 20 points)
- +5 points for Google Summer of Code (GSoC) participation
- +3 points for Girl Script Summer of Code participation
- +3-5 points for startup founder/co-founder experience
- +2-3 points for early-stage engineer experience (first 10-20 employees at a startup)
- +2 points for portfolio website / GitHub URL
- +1 point for LinkedIn profile
- +1-3 points for high-quality technical blogs (if provided)

**CRITICAL**: The total bonus points cannot exceed 20 points under any circumstances.

## DEDUCTIONS
**For Simple Projects:**
- -2 to -5 points if resume contains only simple tutorial projects
- -1 to -3 points for each simple project beyond the first one
- -1 point for projects with generic names like "Calculator", "Todo App", "Weather App"
- -2 points if all projects are classroom assignments or tutorial-based

**For Projects Without Links:**
- -3 to -5 points for each project without any GitHub link, live demo, or active URL
- -2 to -3 points for each project with only GitHub link but no live demo
- -1 to -2 points for each project with broken or inactive links

**CRITICAL ENFORCEMENT:**
- When GitHub data shows all projects are 'self_project' type, apply 3-5 point deductions for lack of true open source contributions
- For candidates with only personal GitHub repositories, open source score should NEVER exceed 10 points
- For candidates with only tutorial-based projects, self_projects score should NEVER exceed 15 points

## OUTPUT CONSTRAINTS
- key_strengths: 1-5 items
- areas_for_improvement: 1-3 items
- Evidence fields cannot be empty
- All category scores must be >= 0
- Category maximums: open_source 35, self_projects 30, production 25, technical_skills 10
- Bonus points total must be <= 20
- Overall total (categories + bonus - deductions) cannot exceed 120`;

export function buildCriteria(candidateText, githubBlock) {
  return [
    CRITERIA_BODY,
    '',
    'Candidate data to evaluate:',
    '',
    candidateText,
    githubBlock ? `\n=== GITHUB DATA ===\n${githubBlock}` : '',
  ].join('\n');
}
