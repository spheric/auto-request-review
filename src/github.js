'use strict';

const core = require('@actions/core');
const github = require('@actions/github');
const partition = require('lodash/partition');
const yaml = require('yaml');

class PullRequest {
  // ref: https://developer.github.com/v3/pulls/#get-a-pull-request
  constructor(pull_request_paylaod) {
    // "ncc" doesn't yet support private class fields as of 29 Aug. 2020
    // ref: https://github.com/vercel/ncc/issues/499
    this._pull_request_paylaod = pull_request_paylaod;
  }

  get author() {
    core.info('author')
    core.info(this._pull_request_paylaod)
    return this._pull_request_paylaod.user.login;
  }

  get title() {
    core.info('title')
    return this._pull_request_paylaod.title;
  }

  get is_draft() {
    core.info('is_draft')
    return this._pull_request_paylaod.draft;
  }
}

function get_pull_request() {
  const context = get_context();

  core.info('Get Pull Request')
  core.info(JSON.stringify(context))

  return new PullRequest(context.payload.pull_request);
}

async function fetch_config() {
  const context = get_context();
  const octokit = get_octokit();
  const config_path = get_config_path();

  core.info(context.repo.owner)
  core.info(config_path)
  core.info(context.repo.repo)
  core.info(context.ref)

  const { data: response_body } = await octokit.repos.getContent({
    owner: context.repo.owner,
    repo: context.repo.repo,
    path: config_path,
    ref: context.ref,
  });

  core.info(response_body)

  const content = Buffer.from(response_body.content, response_body.encoding).toString();
  return yaml.parse(content);
}

async function fetch_changed_files() {
  const context = get_context();
  const octokit = get_octokit();

  const changed_files = [];

  const per_page = 100;
  let page = 0;
  let number_of_files_in_current_page;

  do {
    page += 1;

    const { data: response_body } = await octokit.pulls.listFiles({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number,
      page,
      per_page,
    });

    number_of_files_in_current_page = response_body.length;
    changed_files.push(...response_body.map((file) => file.filename));

  } while (number_of_files_in_current_page === per_page);

  return changed_files;
}

async function assign_reviewers(reviewers) {
  const context = get_context();
  const octokit = get_octokit();

  const [ teams_with_prefix, individuals ] = partition(reviewers, (reviewer) => reviewer.startsWith('team:'));
  const teams = teams_with_prefix.map((team_with_prefix) => team_with_prefix.replace('team:', ''));

  return octokit.pulls.requestReviewers({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request.number,
    reviewers: individuals,
    team_reviewers: teams,
  });
}

async function list_team_members(team) {
  const octokit = get_octokit();
  const context = get_context();

  core.info(`Org:${context.repo.owner}. Listing team members for team ${team}`);
  try {
    const { data: response_body } = await octokit.teams.listMembersInOrg({ org: context.repo.owner, team_slug: team })

    return response_body.map((member) => member.login);
  } catch (error) {
    if (error.status === 404) {
      core.warning('No team was found');

      return [];
    }
  }
}

async function list_requested_reviewers() {
  const octokit = get_octokit();
  const context = get_context();

  const { data: response_body } = await octokit.pulls.listRequestedReviewers({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request.number,
  })

  core.info(JSON.stringify(response_body));

  return response_body.map((member) => member.login);
}

/* Private */

let context_cache;
let token_cache;
let config_path_cache;
let octokit_cache;

function get_context() {
  return context_cache || (context_cache = github.context);
}

function get_token() {
  return token_cache || (token_cache = core.getInput('token'));
}

function get_config_path() {
  return config_path_cache || (config_path_cache = core.getInput('config'));
}

function get_octokit() {
  if (octokit_cache) {
    return octokit_cache;
  }

  const token = get_token();
  return octokit_cache = github.getOctokit(token);
}

function clear_cache() {
  context_cache = undefined;
  token_cache = undefined;
  config_path_cache = undefined;
  octokit_cache = undefined;
}

module.exports = {
  get_pull_request,
  fetch_config,
  fetch_changed_files,
  assign_reviewers,
  list_team_members,
  list_requested_reviewers,
  clear_cache,
};
