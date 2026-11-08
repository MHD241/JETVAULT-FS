# 737 model generators (kept for later)

- `conv2_with_flaps_wip.py`: converts the supplied boy737 OBJ+MTL (not in the repo) into `public/models/b738_full.bin`, cutting out the elevators, ailerons, rudder AND the flap/pod work (paused: the flaps look messy; revisit later). Paths inside point at the original upload location; edit them for your machine.
- `packck.mjs`: compresses the flight deck glb with meshopt (84 -> 16 MB).

The model in use right now (`b738_full.bin`) is the version WITHOUT flaps/pods (commit 8f50243): elevators, ailerons and rudder move; flaps and pods are fixed.
