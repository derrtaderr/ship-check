# Build queue (fixture)

### OUTBOUND

**2. ESP provider-detection resurrection**
- **Lane:** repo=`esp` unit=1 eligible=yes
- MX lookup then tag then route.

**4. Metrics definitions layer for billing-service**
- **Lane:** repo=`billing-service` unit=2 eligible=yes

**6. Newsletter loop arc closing**
- **Lane:** repo=`repo-c` unit=1 eligible=no

**8. Business brain**
- No lane field at all, so this row is not eligible.

**7. A bold marker inside prose, not a header** and it keeps going
- No Lane field. Trailing-prose regression case: the closing bold marker is
  followed by more text on the same line, and the parser must not swallow it
  into the title.

**9. Investor-portfolio overlap mapper**
- **Lane:** repo=`overlap-mapper` unit=3 eligible=yes

**10. Command-center map render — ask a question, get a diagram
back (expanded from the earlier surface candidate).** Wrapped-header
regression case: this row's bold does not close on the line where the header
starts.
- **Lane:** repo=`command-center` unit=1 eligible=yes
