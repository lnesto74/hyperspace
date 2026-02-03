export const KPI_DEFINITIONS: Record<string, string> = {
  // Basic Metrics
  visits: "The count of people who had at least one measurement in the area during the defined time period. Visits are not a count of the total number of times a visitor is measured. It is only incremented once per location visit.",
  totalEntries: "The total number of times people entered the zone, including repeat entries by the same person.",
  timeSpent: "The total measured time of all people in the area during the defined time period (in minutes).",
  avgTimeSpent: "The average amount of time people spend in the area. Calculated as Time Spent / Visits.",
  avgTimeSpentCT: "Complete Track (CT) version of Avg Time Spent. Reflects the average time spent by tracks that did not start or end within the area. Designed to provide accurate reflection by omitting partial tracks.",

  // Dwell Metrics
  dwellAvgTime: "The average time spent in an area by visits that meet the definition of a Dwell in that area.",
  dwellAvgTimeCT: "Complete Track (CT) version of Dwell Average Time. Reflects average time by tracks that dwelled and did not start or end within the area.",
  dwellsCumulative: "The number of times people spent consecutive time in an area exceeding the minimum threshold set for a Dwell (default 60 seconds). Multiple dwells are only counted when there is an intervening measurement outside the area.",
  dwellsUnique: "A unique count of people who spent consecutive time exceeding the Dwell threshold. A person can have no more than one Dwell Unique per area per visit.",
  dwellsPerVisit: "The average number of Dwells per visit to an area. Calculated as Dwells Cumulative / Visits.",
  dwellRate: "The percentage of visits to an area that exceed the time threshold required for a Dwell. Calculated as Dwells Unique / Visits.",
  dwellShare: "The percentage of all Dwells Cumulative measured in the specific area for the time period. Calculated as Dwells Cumulative / Sum (All Location Dwells).",

  // Engagement Metrics
  engagementAvgTime: "The average time spent in an area by visits that meet the definition of an Engagement in that area.",
  engagementAvgTimeCT: "Complete Track (CT) version of Engagement Average Time. Reflects average time by tracks that engaged and did not start or end within the area.",
  engagementsCumulative: "The number of times people spent consecutive time exceeding the minimum threshold set for Engagements (default 120 seconds). Multiple Engagements are only counted when there is an intervening measurement outside the area.",
  engagementsUnique: "A unique count of people who spent consecutive time exceeding the Engagement threshold. A person can have no more than one Engagement Unique per area per visit.",
  engagementsPerVisit: "The average number of Engagements per visit to an area. Calculated as Engagements Cumulative / Visits.",
  engagementRate: "The percentage of visits to an area that exceed the time threshold required for an Engagement. Calculated as Engagements Unique / Visits.",
  engagementShare: "The percentage of all Engagements Cumulative measured in the specific area. Calculated as Engagements Cumulative / Sum (All Location Engagements).",

  // Flow Metrics
  draws: "A person's first Dwell in the location. There can only be one Draw per visit across all areas of the location.",
  drawRate: "The percentage of visits to the area that contained a Draw. Calculated as Draws / Visits.",
  drawShare: "The percentage of all Draws measured in the specific area. Calculated as Draws / Sum (All Location Draws).",
  exits: "The last place a person Dwelled before exiting the location without a Conversion.",
  exitRate: "The percentage of visits to the area that resulted in an Exit. Calculated as Exits / Visits.",
  exitShare: "The percentage of all Exits measured in the specific area. Calculated as Exits / Sum (All Location Exits).",
  bounces: "The number of times people had a Dwell in an area without having a previous or subsequent Dwell in any other area. There can be at most one Bounce per visit across all areas.",
  bounceRate: "The percentage of visits to the area that resulted in a Bounce. Calculated as Bounces / Visits.",
  bounceShare: "The percentage of all Bounces measured in the specific area. Calculated as Bounces / Sum (All Location Bounces).",

  // Occupancy Metrics
  peakOccupancy: "The maximum count of concurrent people observed within the area for a specified period of time.",
  avgOccupancy: "The average count of concurrent people observed within the area for a specified period of time.",
  currentOccupancy: "The current number of people detected in the zone right now.",

  // Velocity Metrics
  avgVelocity: "The average velocity of people within a specified area.",
  avgVelocityInMotion: "The average velocity of people who are moving, excluding time periods where a person is static.",
  atRestTotalTime: "The amount of time in minutes that a person is standing/sitting still.",
  inMotionTotalTime: "The amount of time in minutes that a person is in motion.",
  percentAtRest: "The share of time in minutes that a person is standing/sitting still.",
  percentInMotion: "The share of time in minutes that a person is in motion.",

  // Conversion Metrics
  conversions: "The number of times a person had a Dwell Unique in a Section defined as a Conversion area.",
  conversionRate: "The percentage of visits that resulted in a Conversion. Calculated as Conversions / Visits.",
  attributedConversions: "The number of times a shopper had a Dwell Unique in an area followed by a subsequent Conversion.",
  attributedConversionRate: "The percentage of visits to the area that preceded a Conversion. Calculated as Attributed Conversions / Visits.",
  conversionDrivers: "The number of times a shopper had a Dwell Cumulative in an area followed immediately by a Conversion.",
  conversionDriverRate: "The percentage of Dwells Cumulative that immediately preceded a Conversion. Calculated as Conversion Drivers / Visits.",

  // Group Metrics
  groupVisits: "The count of groups who had at least one measurement in the area during the defined time period.",
  groupTimeSpent: "The total measured time Groups spend in the area during the defined time period (in minutes).",
  groupAvgTimeSpent: "The average amount of time Groups spend in the area. Calculated as Group Time Spent / Group Visits.",
  groupConversions: "The number of times a group had a Dwell Unique in a Section defined as a Conversion area.",

  // Utilization Metrics
  utilizationTime: "The minutes during open hours that an area has occupancy equal to or greater than a defined occupancy threshold.",
  utilizationRate: "The percentage of time during open hours that an area is above a defined occupancy threshold.",
}
