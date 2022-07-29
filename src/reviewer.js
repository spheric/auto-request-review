'use strict';

const core = require('@actions/core');
const minimatch = require('minimatch');
const sample_size = require('lodash/sampleSize');
const github = require('./github'); // Don't destructure this object to stub with sinon in tests
const partition = require('lodash/partition');

function fetch_other_group_members({ author, config }) {
  const DEFAULT_OPTIONS = {
    enable_group_assignment: false,
  };

  const { enable_group_assignment: should_group_assign } = {
    ...DEFAULT_OPTIONS,
    ...config.options,
  };

  if (!should_group_assign) {
    core.info('Group assignment feature is disabled');
    return [];
  }

  core.info('Group assignment feature is enabled');

  const groups = (config.reviewers && config.reviewers.groups) || {};
  const belonging_group_names = Object.entries(groups).map(([ group_name, members ]) =>
    members.includes(author) ? group_name : undefined
  ).filter((group_name) => group_name);

  const other_group_members = belonging_group_names.flatMap((group_name) =>
    groups[group_name]
  ).filter((group_member) => group_member !== author);

  return [ ...new Set(other_group_members) ];
}

function identify_reviewers_by_changed_files({ config, changed_files, excludes = [] }) {
  if (!config.files) {
    core.info('A "files" key does not exist in config; returning no reviewers for changed files.');
    return [];
  }

  const matching_reviewers = [];

  Object.entries(config.files).forEach(([ glob_pattern, reviewers ]) => {
    if (changed_files.some((changed_file) => minimatch(changed_file, glob_pattern))) {
      matching_reviewers.push(...reviewers);
    }
  });

  const individuals = replace_groups_with_individuals({ reviewers: matching_reviewers, config });

  return exclude_reviewers({ reviewers: individuals, excludes: excludes })
}

function identify_reviewers_by_author({ config, 'author': specified_author }) {
  if (!(config.reviewers && config.reviewers.per_author)) {
    core.info('"per_author" is not set; returning no reviewers for the author.');
    return [];
  }

  // More than one author can be matched because groups are set as authors
  const matching_authors = Object.keys(config.reviewers.per_author).filter((author) => {
    if (author === specified_author) {
      return true;
    }

    const individuals_in_author_setting = replace_groups_with_individuals({ reviewers: [ author ], config });

    if (individuals_in_author_setting.includes(specified_author)) {
      return true;
    }

    return false;
  });

  const matching_reviewers = matching_authors.flatMap((matching_author) => {
    const reviewers = config.reviewers.per_author[matching_author] || [];
    return replace_groups_with_individuals({ reviewers, config });
  });

  return matching_reviewers.filter((reviewer) => reviewer !== specified_author);
}

function should_request_review({ title, is_draft, config }) {
  const DEFAULT_OPTIONS = {
    ignore_draft: true,
    ignored_keywords: [ 'DO NOT REVIEW' ],
  };

  const { ignore_draft: should_ignore_draft, ignored_keywords } = {
    ...DEFAULT_OPTIONS,
    ...config.options,
  };

  if (should_ignore_draft && is_draft) {
    return false;
  }

  return !ignored_keywords.some((keyword) => title.includes(keyword));
}

function fetch_default_reviewers({ config, excludes = [] }) {
  if (!config.reviewers || !Array.isArray(config.reviewers.defaults)) {
    return [];
  }

  const individuals = replace_groups_with_individuals({ reviewers: config.reviewers.defaults, config });

  return exclude_reviewers({ reviewers: individuals, excludes: excludes })
}

function filter_excluded_reviewers({ reviewers, config }) {
  const { exclude } = {
    ...config.options,
  };

  const excluded_individuals = replace_groups_with_individuals({ reviewers: exclude || [], config });

  return exclude_reviewers({ reviewers, excludes: excluded_individuals })
}

function exclude_reviewers({ reviewers, excludes = []}) {
  // Dedupe and filter results
  return [ ...new Set(reviewers) ].filter((reviewer) => !excludes.includes(reviewer));
}

function randomly_pick_reviewers({ reviewers, config }) {
  const { number_of_reviewers } = {
    ...config.options,
  };

  if (number_of_reviewers === undefined) {
    return reviewers;
  }

  return sample_size(reviewers, number_of_reviewers);
}

async function fetch_author_belongs_to_github_team_members({ reviewers, config, author }) {
  const DEFAULT_OPTIONS = {
    force_pick: false
  };

  const { load_github_members, force_pick } = {
    ...DEFAULT_OPTIONS,
    ...config.options,
  };

  if (load_github_members === undefined) {
    return reviewers;
  }

  const [ teams_with_prefix, individuals ] = partition(reviewers, (reviewer) => reviewer.startsWith('team:'));
  const teams = teams_with_prefix.map((team_with_prefix) => team_with_prefix.replace('team:', ''));
  const unresolved_promises = teams.map(team => github.list_team_members(team))

  let team_members = await Promise.all(unresolved_promises)

  if(!force_pick) {
    team_members = team_members.filter((members) => members.includes(author))
  }

  team_members = team_members.flat().filter((member) => member !== author)

  return [...new Set([ ...individuals, ...team_members ])]
}


async function filter_already_requested_reviewers({ reviewers, config }) {
  const { load_github_members } = {
    ...config.options,
  };

  if (load_github_members === undefined) {
    return reviewers;
  }

  const requested_reviewers = await github.list_requested_reviewers()

  return reviewers.filter((reviewer) => !requested_reviewers.includes(reviewer))
}

/* Private */

function replace_groups_with_individuals({ reviewers, config }) {
  const groups = (config.reviewers && config.reviewers.groups) || {};
  return reviewers.flatMap((reviewer) =>
    Array.isArray(groups[reviewer]) ? groups[reviewer] : reviewer
  );
}

module.exports = {
  fetch_other_group_members,
  identify_reviewers_by_changed_files,
  identify_reviewers_by_author,
  should_request_review,
  fetch_default_reviewers,
  filter_excluded_reviewers,
  fetch_author_belongs_to_github_team_members,
  filter_already_requested_reviewers,
  randomly_pick_reviewers,
};
