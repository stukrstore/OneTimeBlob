const {
  BlobServiceClient,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} = require("@azure/storage-blob");
const { DefaultAzureCredential } = require("@azure/identity");
const config = require("./config");

function getBlobServiceClient() {
  const credential = new DefaultAzureCredential();
  const url = `https://${config.storage.account}.blob.core.windows.net`;
  return new BlobServiceClient(url, credential);
}

async function uploadCsvToBlob(id, csvContent) {
  const blobServiceClient = getBlobServiceClient();
  const containerClient = blobServiceClient.getContainerClient(
    config.storage.container
  );

  const blobPath = `audience/${id}/data.csv`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

  await blockBlobClient.upload(csvContent, Buffer.byteLength(csvContent), {
    blobHTTPHeaders: { blobContentType: "text/csv" },
    overwrite: true,
  });

  const location = `abfss://${config.storage.container}@${config.storage.account}.dfs.core.windows.net/${blobPath}`;
  return { location, blobPath };
}

async function generateOnetimeUrl(blobPath) {
  const blobServiceClient = getBlobServiceClient();

  const now = new Date();
  const expiresOn = new Date(
    now.getTime() + config.sas.expiryMinutes * 60 * 1000
  );

  const userDelegationKey = await blobServiceClient.getUserDelegationKey(
    now,
    expiresOn
  );

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: config.storage.container,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("r"),
      startsOn: now,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    userDelegationKey,
    config.storage.account
  ).toString();

  return `https://${config.storage.account}.blob.core.windows.net/${config.storage.container}/${blobPath}?${sasToken}`;
}

module.exports = { uploadCsvToBlob, generateOnetimeUrl };
