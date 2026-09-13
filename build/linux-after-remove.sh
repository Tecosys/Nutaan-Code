#!/bin/bash

# Replaces electron-builder's own after-remove template, which passes the wrong path to
# update-alternatives and does not distinguish an upgrade from a removal.
#
# The old package's remove script runs *after* the new package has installed its alternative, so
# on an upgrade there is nothing to undo — tearing the link down here would remove the one the new
# version just registered. rpm passes the number of versions left behind (0 on a real removal, 1
# during an upgrade) while dpkg passes a word, so both conventions are matched below.
case "$1" in
  0|remove|purge) ;;
  *) exit 0 ;;
esac

if type update-alternatives >/dev/null 2>&1; then
    # --remove wants the target that --install registered, which is the binary under /opt rather
    # than the /usr/bin link. Passing the link makes update-alternatives exit 2, and rpm treats a
    # failed %postun as a failed transaction, which is what left the old version installed.
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}' || true
else
    rm -f '/usr/bin/${executable}'
fi
