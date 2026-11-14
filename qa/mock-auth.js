// QA only: always signed in.
const user = { uid: "qa", email: "qa@3dbee.test", getIdToken: async () => "qa-token" };
export const getAuth = () => ({ currentUser: user });
export const onAuthStateChanged = (_a, cb) => { setTimeout(() => cb(user), 0); return () => {}; };
export const signInWithEmailAndPassword = async () => ({ user });
export const signOut = async () => {};
