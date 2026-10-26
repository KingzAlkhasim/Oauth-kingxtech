const result = { data: null, error: null, count: 0 };
const chain = () => new Proxy(function () {}, { get: (_t, p) => (p === 'then' ? (res) => res(result) : chain()), apply: () => chain() });
const user = { id: 'u1', email: 'a@b.c', user_metadata: { full_name: 'Test' } };
const session = { access_token: 't', user };
export const supabase = { auth: { getSession: async () => ({ data: { session }, error: null }), getUser: async () => ({ data: { user }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) }, from: () => chain(), rpc: () => chain(), channel: () => chain(), removeChannel: () => {}, functions: { invoke: async () => result } };
