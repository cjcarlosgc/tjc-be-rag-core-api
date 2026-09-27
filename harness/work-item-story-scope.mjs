export function taskStoriesFitWorkItem(taskStories, workItemStories) {
  return taskStories.size > 0 && [...taskStories].every((storyId) => workItemStories.has(storyId));
}
