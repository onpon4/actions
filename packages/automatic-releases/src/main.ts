import * as core from '@actions/core';
import * as github from '@actions/github';
import * as Octokit from '@octokit/rest';
import {dumpGitHubEventPayload} from '../../keybase-notifications/src/utils';

type Args = {
  repoToken: string;
  releaseTag: string;
  draftRelease: boolean;
  preRelease: boolean;
  releaseTitle: string;
  releaseBody: string;
};

function getAndValidateArgs(): Args {
  const args = {
    repoToken: core.getInput('repo_token', {required: true}),
    releaseTag: core.getInput('release_tag', {required: true}),
    draftRelease: JSON.parse(core.getInput('draft', {required: true})),
    preRelease: JSON.parse(core.getInput('prerelease', {required: true})),
    releaseTitle: core.getInput('title', {required: true}),
    releaseBody: core.getInput('body', {required: false}),
  };

  if (!args.releaseBody) {
    args.releaseBody = `Automatically generated from the current master branch (${github.context.sha})`;
  }

  return args;
}

async function createReleaseTag(client: github.GitHub, refInfo: Octokit.GitCreateRefParams) {
  core.startGroup('Generating release tag');
  const friendlyTagName = refInfo.ref.substring(10); // 'refs/tags/latest' => 'latest'
  console.log(`Attempting to create or update release tag "${friendlyTagName}"`);

  try {
    await client.git.createRef(refInfo);
  } catch (err) {
    const existingTag = refInfo.ref.substring(5); // 'refs/tags/latest' => 'tags/latest'
    console.log(
      `Could not create new tag "${refInfo.ref}" (${err.message}) therefore updating existing tag "${existingTag}"`,
    );
    await client.git.updateRef({
      ...refInfo,
      ref: existingTag,
      force: true,
    });
  }

  console.log(`Successfully created or updated the release tag "${friendlyTagName}"`);
  core.endGroup();
}

async function deletePreviousGitHubRelease(client: github.GitHub, releaseInfo: Octokit.ReposGetReleaseByTagParams) {
  core.startGroup(`Deleting GitHub releases associated with the tag "${releaseInfo.tag}"`);
  try {
    console.log(`Searching for releases corresponding to the "${releaseInfo.tag}" tag`);
    const resp = await client.repos.getReleaseByTag(releaseInfo);

    console.log(`Deleting release: ${resp.data.id}`);
    await client.repos.deleteRelease({
      owner: releaseInfo.owner,
      repo: releaseInfo.repo,
      release_id: resp.data.id, // eslint-disable-line @typescript-eslint/camelcase
    });
  } catch (err) {
    console.log(`Could not find release associated with tag "${releaseInfo.tag}" (${err.message})`);
  }
  core.endGroup();
}

async function generateNewGitHubRelease(client: github.GitHub, releaseInfo: Octokit.ReposCreateReleaseParams) {
  core.startGroup(`Generating new GitHub release for the "latest" tag`);

  console.log('Creating new release');
  await client.repos.createRelease(releaseInfo);
  core.endGroup();
}

export async function main() {
  try {
    const args = getAndValidateArgs();
    const client = new github.GitHub(args.repoToken);

    core.startGroup('Initializing the Automatic Releases action');
    dumpGitHubEventPayload();
    core.endGroup();

    await createReleaseTag(client, {
      owner: github.context.repo.owner,
      ref: `refs/tags/${args.releaseTag}`,
      repo: github.context.repo.repo,
      sha: github.context.sha,
    });

    await deletePreviousGitHubRelease(client, {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      tag: args.releaseTag,
    });

    await generateNewGitHubRelease(client, {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      tag_name: args.releaseTag, // eslint-disable-line @typescript-eslint/camelcase
      name: args.releaseTitle,
      draft: args.draftRelease,
      prerelease: args.preRelease,
      body: args.releaseBody,
    });
  } catch (error) {
    core.setFailed(error.message);
    throw error;
  }
}
