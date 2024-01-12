const catalyst = require('zcatalyst-sdk-node');
const axios = require('axios');

module.exports = async (cronDetails, context) => {

  try {
    //Receiving cron params
    const org_id = cronDetails.getCronParam("org_id");
    const zoho_finance_org_id = cronDetails.getCronParam("zoho_finance_org_id");
    const seller_token = cronDetails.getCronParam("seller_token");
    const catalystApp = catalyst.initialize(context);
    const zcqlAPI = catalystApp.zcql();
    // getting jwt_token,x_api_key of easyecom_authorization table from data store
    const query = `SELECT jwt_token,x_api_key FROM easyecom_authorization WHERE seller_token=${seller_token}`;
    const queryResult = await zcqlAPI.executeZCQLQuery(query);
    const jwtToken = queryResult[0].easyecom_authorization.jwt_token;
    const xApiKey = queryResult[0].easyecom_authorization.x_api_key;
    //make request to get all order using function 
    await getAllOrder(jwtToken, xApiKey, org_id, zoho_finance_org_id, seller_token, catalystApp, zcqlAPI).catch((error) => {
      // Handle any unhandled rejections that might occur outside the async function
      console.error('getAllOrder error:', error);
      context.closeWithFailure();
    })
    context.closeWithSuccess();
  } catch (error) {
    // starting query error
    console.error("Error in starting:", error.message);
    context.closeWithFailure();
  }

  // get orders function block
  async function getAllOrder(jwtToken, xApiKey, org_id, zoho_finance_org_id, seller_token, catalystApp, zcqlAPI) {
    try {
      const easyecom_api_url = 'https://api.easyecom.io';
      const delay = 1500;

      function formatDate(date_time) {
        let date = ("0" + date_time.getDate()).slice(-2);
        let month = ("0" + (date_time.getMonth() + 1)).slice(-2);
        let year = date_time.getFullYear();
        let hours = ("0" + date_time.getHours()).slice(-2);
        let minutes = ("0" + date_time.getMinutes()).slice(-2);
        let seconds = ("0" + date_time.getSeconds()).slice(-2);

        return year + "-" + month + "-" + date + " " + hours + ":" + minutes + ":" + seconds;
      }

       var ISToffSet = 330; //IST is 5:30; i.e. 60*5+30 = 330 in minutes 
      offset = ISToffSet * 60 * 1000;
      const date = new Date();     
      var date_time = new Date(date.getTime() + offset);
      // Store the current time
      const currentTime = formatDate(date_time);
      console.log("Current Time:", currentTime);

      // Subtract one hour from the current date and time
      date_time.setHours(date_time.getHours() - 1);

      // Handle the case where the hour becomes negative
      if (date_time.getHours() < 0) {
        date_time.setDate(date_time.getDate() - 1);
        date_time.setHours(23);
      }

      // Store the time one hour before
      const oneHourBefore = formatDate(date_time);
      console.log("One Hour Before:", oneHourBefore);

      const startDate = '2023-12-18 00:00:00';//oneHourBefore
      const endDate = '2023-12-18 23:59:59';//currentTime;

      // const startDate = oneHourBefore;//oneHourBefore
      // const endDate = currentTime;//currentTime;

      const endPoint = `/orders/getAllOrdersCount?updated_after=${encodeURIComponent(startDate)}&updated_before=${encodeURIComponent(endDate)}&status_id=7`;
      const orderCountUrl = `${easyecom_api_url}${endPoint}`;

      // Api call to fetch Total order count
      const countResponse = await axios.get(orderCountUrl, {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
        },
      });

      if (countResponse.status === 200 && countResponse.data && countResponse.data.code === 200) {
        const countData = countResponse.data.data;

        if (countData.totalCount > 0) {
          let nextUrl = `/orders/V2/getAllOrders?updated_after=${encodeURIComponent(startDate)}&updated_before=${encodeURIComponent(endDate)}&limit=250&status_id=7`;
          const easyecom_orders_table = catalystApp.datastore().table("easyecom_orders");

          while (nextUrl) {
            const getAllOrdersUrl = `${easyecom_api_url}${nextUrl}`;
            // Api call to fetch all orders
            try {
              const getAllOrdersResponse = await axios.get(getAllOrdersUrl, {
                headers: {
                  "x-api-key": `${xApiKey}`,
                  Authorization: `Bearer ${jwtToken}`,
                },
              });

              if (getAllOrdersResponse.status === 200) {
                const api_response = getAllOrdersResponse.data;
                const orderList = api_response.data.orders;
                if (orderList) {
                  // insert all order into easyecom order table using for loop
                  for (const element of orderList) {
                    let queryFetch = `SELECT * FROM easyecom_orders WHERE easyecom_order_id = ${element.order_id} AND easyecom_seller_token = ${seller_token} AND org_id = ${org_id}`;
                    const queryResults = await zcqlAPI.executeZCQLQuery(queryFetch);
                    if (queryResults.length === 0) { // if above query not matched, inserting data to the table
                      await easyecom_orders_table.insertRow({
                        "org_id": org_id,
                        "easyecom_invoice_id": element.invoice_id,
                        "easyecom_order_id": element.order_id,
                        "zoho_finance_org_id": zoho_finance_org_id,
                        "easyecom_seller_token": seller_token,
                        "easyecom_json": element
                      });
                    }
                    else if (queryResults.length > 0) { // if above query(queryFetch) match data
                      // additional check with invoice id
                      let queryWithInvoiceId = `SELECT * FROM easyecom_orders WHERE easyecom_order_id = ${element.order_id} AND easyecom_seller_token = ${seller_token} AND org_id = ${org_id} AND easyecom_invoice_id = ${element.invoice_id}`;
                      const resultWithInvoiceId = await zcqlAPI.executeZCQLQuery(queryWithInvoiceId);
                      if (resultWithInvoiceId.length > 0) { // if above query(queryWithInvoiceId) match data 
                        // no task
                        console.log("no task")
                      }
                      else { // if above query(queryWithInvoiceId) match no data 
                        const zoho_order_status = "Success"
                        // additional check with zoho order status
                        let queryWithSuccess = `SELECT * FROM easyecom_orders WHERE easyecom_order_id = ${element.order_id} AND easyecom_seller_token = ${seller_token} AND org_id = ${org_id} AND zoho_order_status=${zoho_order_status}`;
                        const resultWithSuccess = await zcqlAPI.executeZCQLQuery(queryWithSuccess);
                        if (resultWithSuccess.length > 0) { // if above query(queryWithSuccess) match data 
                          const zoho_so_no = resultWithSuccess[0].easyecom_orders.zoho_so_no;
                          const zoho_so_id = resultWithSuccess[0].easyecom_orders.zoho_so_id;
                          const zoho_order_status = resultWithSuccess[0].easyecom_orders.zoho_order_status;
                          // inserting zoho_so_no, zoho_so_id with status success
                          await easyecom_orders_table.insertRow({
                            "org_id": org_id,
                            "zoho_order_status": zoho_order_status,
                            "easyecom_order_id": element.order_id,
                            "easyecom_invoice_id": element.invoice_id,
                            "zoho_so_no": zoho_so_no,
                            "zoho_so_id": zoho_so_id,
                            "easyecom_json": element,
                            "easyecom_seller_token": seller_token,
                            "zoho_finance_org_id": zoho_finance_org_id
                          });
                        }
                        else {  // if above query(queryWithSuccess) match no data
                          await easyecom_orders_table.insertRow({
                            "org_id": org_id,
                            "easyecom_invoice_id": element.invoice_id,
                            "easyecom_order_id": element.order_id,
                            "zoho_finance_org_id": zoho_finance_org_id,
                            "easyecom_seller_token": seller_token,
                            "easyecom_json": element
                          });
                        }
                      }
                    }
                  };
                  await new Promise(resolve => setTimeout(resolve, delay));
                }
                else {
                  console.log("no data found")
                }
                nextUrl = api_response.data.nextUrl;
              } else {
                throw new Error(`getAllOrdersResponse API request failed. Response: ${JSON.stringify(getAllOrdersResponse.data)}`);
              }
            } catch (error) {
              console.error(`Error in getAllOrdersResponse API request: ${error.message}`);
              context.closeWithFailure();
            }
          }
        } else {
          console.log("No orders found.");
        }
      } else {
        throw new Error(`countResponse API request failed. Response: ${JSON.stringify(countResponse.data)}`);
      }
    } catch (error) {
      console.error(`Error making API request: ${error}`);
      context.closeWithFailure();
    }
  }
};
