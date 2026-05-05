# This file contains a set of controls for JobDash in lieu of a user interface.
# JobDash will look at this configuration file when first running in order to build out the interface and search parameters

## BASIC SETTINGS
These are the basic parameters to be passed to JobSpy (the service that does the actual search). Docs at https://github.com/speedyapply/JobSpy    
- site_name=["indeed", "linkedin", "glassdoor"]
- search_term='("UX" OR "Product Designer" OR "User Researcher")
- results_wanted=60
- hours_old=336
- country_indeed="UK"

## LOCATIONS
### In-Person/Hybrid/Remote
JobDash will search for in-person, hybrid or remote roles in each of the following locations/countries and distances and create a tab to display them (e.g. "Edinburgh, UK, 10" will create a tab containing jobs within 10 miles of Edinburgh, UK). 
- Edinburgh, UK, 10
- Glasgow, UK, 10
- Scotland, UK, 0
- Newcastle, UK, 10
- London, UK, 0
- Melbourne, Australia, 0

### Remote Only
JobDash will search for remote roles in these countries and create a tab to display them. See the list of compatible countries in the JobSpy docs:
- UK

## FILTERS
Results returned from JobSpy will be further filtered as follows:

### INCLUDE
Jobs with titles containing the following will be included:
- UX
- User Experience
- User
- Product
- Designer
- Researcher

### EXCLUDE
Jobs with titles containing the following will be excluded:
- Developer
- Artist
- Engineer
- Content
- Graphic
- Brand
- Product Manager
- Product Owner
- Management
- Marketing

### BLACKLIST
Companies in this list will be excluded:
- DataAnnotation
- Prolific
- Crossing Hurdles
- Rockstar Games

