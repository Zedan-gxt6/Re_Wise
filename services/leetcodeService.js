export async function fetchLeetcodeMetadata(slug) {
  const response = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: `https://leetcode.com/problems/${slug}/`,
    },
    body: JSON.stringify({
      query: `query questionData($titleSlug: String!) { question(titleSlug: $titleSlug) { title titleSlug difficulty topicTags { name slug } } }`,
      variables: { titleSlug: slug },
    }),
  });

  if (!response.ok) throw new Error(`LeetCode GraphQL failed with ${response.status}`);

  const payload = await response.json();
  const question = payload.data?.question;
  if (!question) throw new Error("LeetCode problem was not found");

  return question;
}
