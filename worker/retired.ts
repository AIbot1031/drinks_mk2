// Preserve the existing Durable Object class and its stored data during retirement.
export {SemanticBridge} from './semantic-bridge';
export const retirementVersion = '3.1.28';
export const destination = 'https://drinks-mk4.rtx941031.workers.dev/card-table/';

export default {
  fetch(): Response {
    // 303 also converts old form/API submissions to a safe GET on the new site.
    // Explicitly clear old fragments and do not forward query strings or bodies.
    return new Response(null, {status: 303, headers: {
      Location: destination + '#',
      'Cache-Control': 'no-store',
      'X-App-Version': retirementVersion,
      'X-Content-Type-Options': 'nosniff',
    }});
  },
};
