import {defineStore} from "./zustand-server";

interface MyOpts {
  userId: number;
}
interface MyState {
  name: string;
  setName: (name: string) => void;
}
export default defineStore<MyOpts, MyState>(({ userId }, set) => {
  return {
    state: {
      name: "",
      setName: (name: string) => {
        set({
          name,
        });
      },
    },
    promises: {
      name: new Promise((resolve) => {
        // imagine this depended on userId
        setTimeout(() => resolve("bob"), 100);
      }),
    },
  };
});
